#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  getSimulationFixture,
  listSimulationFixtures,
} from "./simulation-fixtures.mjs";

const VALID_SPAWN_CONFIGS = ["conservative", "balanced", "aggressive"];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

function main() {
  const { values } = parseArgs({
    options: {
      ticks: { type: "string", short: "t", default: "1000" },
      json: { type: "boolean", default: false },
      markdown: { type: "boolean", default: false },
      seed: { type: "string", default: "screeps-bounty-arena" },
      fixture: { type: "string" },
      "list-fixtures": { type: "boolean", default: false },
      "room-seed": { type: "string" },
      "spawn-seed": { type: "string" },
      "spawn-config": { type: "string", default: "balanced" },
      "require-rcl": { type: "string" },
      "require-rcl-by": { type: "string" },
      "max-failures": { type: "string", default: "0" },
    },
  });

  const ticks = Number.parseInt(values.ticks, 10);
  if (values["list-fixtures"]) {
    console.log(JSON.stringify(listSimulationFixtures(), null, 2));
    return;
  }

  if (!Number.isFinite(ticks) || ticks <= 0) {
    throw new Error(`--ticks must be a positive integer, got ${values.ticks}`);
  }

  const gates = parseGateOptions({
    requireRcl: values["require-rcl"],
    requireRclBy: values["require-rcl-by"],
    maxFailures: values["max-failures"],
  });

  const result = runOfflineSimulation({
    ticks,
    seed: values.seed,
    fixtureName: values.fixture,
    roomSeed: values["room-seed"],
    spawnSeed: values["spawn-seed"],
    spawnConfig: values["spawn-config"],
    gates,
  });

  if (values.json && values.markdown) {
    throw new Error("Use only one output mode: --json or --markdown");
  }

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (values.markdown) {
    console.log(formatMarkdownReport(result));
  } else {
    console.log(formatSummary(result));
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

export function runOfflineSimulation({
  ticks,
  seed = "screeps-bounty-arena",
  fixtureName,
  roomSeed,
  spawnSeed,
  spawnConfig = "balanced",
  gates = {},
}) {
  const fixture = fixtureName ? getSimulationFixture(fixtureName) : undefined;
  if (fixtureName && fixture === undefined) {
    throw new Error(
      `Unknown fixture '${fixtureName}'. Use --list-fixtures to inspect available fixtures.`,
    );
  }

  const seeds = normalizeSimulationSeeds({
    seed: fixture?.seed ?? seed,
    roomSeed: roomSeed ?? fixture?.roomSeed,
    spawnSeed: spawnSeed ?? fixture?.spawnSeed,
    spawnConfig: fixture?.spawnConfig ?? spawnConfig,
  });
  assertValidSpawnConfig(seeds.spawnConfig);
  const roomRng = mulberry32(hashSeed(seeds.roomSeed));
  const spawnRng = mulberry32(
    hashSeed(`${seeds.spawnSeed}:${seeds.spawnConfig}`),
  );
  const initialRoom = fixture?.initialRoom ?? {};
  const room = {
    tick: 0,
    rcl: initialRoom.rcl ?? 1,
    controllerProgress: initialRoom.controllerProgress ?? 0,
    energy: initialRoom.energy ?? 300,
    energyCapacity: initialRoom.energyCapacity ?? 300,
    creeps: initialRoom.creeps ?? 1,
    constructionProgress: initialRoom.constructionProgress ?? 0,
    failures: [],
    spawnAttempts: 0,
    spawnSuccesses: 0,
    lastEvents: [],
  };

  const milestones = [];
  for (let tick = 1; tick <= ticks; tick += 1) {
    room.tick = tick;

    const harvestRate = Math.floor(
      room.creeps *
        (8 + Math.floor(roomRng() * 3)) *
        (fixture?.harvestMultiplier ?? 1),
    );
    const upkeep = Math.max(0, room.creeps - 2) * 2;
    room.energy = Math.min(
      room.energyCapacity,
      room.energy + harvestRate - upkeep,
    );

    const spawnCost = nextSpawnCost(spawnRng, seeds.spawnConfig);
    room.spawnAttempts += 1;
    if (
      room.energy >= spawnCost &&
      room.creeps < desiredCreepsForRcl(room.rcl)
    ) {
      room.energy -= spawnCost;
      room.creeps += 1;
      room.spawnSuccesses += 1;
    }

    const upgradeSpend = Math.min(room.energy, 12 + room.creeps * 2);
    room.energy -= upgradeSpend;
    room.controllerProgress += upgradeSpend;

    const buildSpend = Math.min(room.energy, room.rcl >= 2 ? 8 : 3);
    room.energy -= buildSpend;
    room.constructionProgress += buildSpend;

    if (room.constructionProgress >= room.energyCapacity) {
      room.energyCapacity += 50;
      room.constructionProgress = 0;
    }

    const nextRclProgress = progressForNextRcl(room.rcl);
    if (room.controllerProgress >= nextRclProgress && room.rcl < 8) {
      room.controllerProgress -= nextRclProgress;
      room.rcl += 1;
      room.energyCapacity += 100;
      room.lastEvents.push(`[RCL] tick ${tick}: reached RCL ${room.rcl}`);
      milestones.push({
        tick,
        rcl: room.rcl,
        energyCapacity: room.energyCapacity,
        creeps: room.creeps,
      });
    }

    if (room.energy < 0 || room.creeps <= 0) {
      const failure = {
        tick,
        reason: "invalid colony state",
        energy: room.energy,
        creeps: room.creeps,
      };
      room.failures.push(failure);
      room.lastEvents.push(`[FAIL] tick ${tick}: ${failure.reason} (energy=${failure.energy}, creeps=${failure.creeps})`);
      break;
    }

    // Keep only the last 20 notable events
    if (room.lastEvents.length > 20) {
      room.lastEvents = room.lastEvents.slice(-20);
    }
  }

  const gateResults = evaluateGates({
    gates,
    ticks,
    finalRcl: room.rcl,
    failures: room.failures,
    milestones,
  });

  // Build diagnostics for failed gates
  const failedGates = gateResults.filter((g) => !g.ok);
  const diagnostics = failedGates.length > 0
    ? {
        failedGates: failedGates.map((g) => g.name),
        finalTick: room.tick,
        finalRcl: room.rcl,
        finalProgress: room.controllerProgress,
        finalEnergy: room.energy,
        creepCount: room.creeps,
        spawnAttempts: room.spawnAttempts,
        spawnSuccesses: room.spawnSuccesses,
        lastEvents: room.lastEvents,
      }
    : undefined;

  return {
    ok: room.failures.length === 0 && gateResults.every((gate) => gate.ok),
    ticks,
    seed: seeds.baseSeed,
    fixture:
      fixture === undefined
        ? undefined
        : {
            name: fixture.name,
            description: fixture.description,
          },
    seeds,
    simulationModel: "offline-smoke-v1",
    trustLevel: "smoke",
    caveat:
      "Deterministic approximation only; not a full Screeps engine or private-server proof.",
    gates: gateResults,
    final: {
      rcl: room.rcl,
      controllerProgress: room.controllerProgress,
      energy: room.energy,
      energyCapacity: room.energyCapacity,
      creeps: room.creeps,
    },
    milestones,
    failures: room.failures,
    diagnostics,
  };
}

function parseGateOptions({ requireRcl, requireRclBy, maxFailures }) {
  const gates = {};

  if (requireRcl !== undefined) {
    gates.requireRcl = parsePositiveInteger(requireRcl, "--require-rcl");
  }

  if (requireRclBy !== undefined) {
    gates.requireRclBy = parsePositiveInteger(requireRclBy, "--require-rcl-by");
  }

  gates.maxFailures = parseNonNegativeInteger(maxFailures, "--max-failures");

  if (gates.requireRclBy !== undefined && gates.requireRcl === undefined) {
    throw new Error("--require-rcl-by requires --require-rcl");
  }

  return gates;
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer, got ${value}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer, got ${value}`);
  }
  return parsed;
}

function evaluateGates({ gates, ticks, finalRcl, failures, milestones }) {
  const results = [];
  const maxFailures = gates.maxFailures ?? 0;

  results.push({
    name: "max-failures",
    ok: failures.length <= maxFailures,
    expected: maxFailures,
    actual: failures.length,
  });

  if (gates.requireRcl !== undefined) {
    const milestone = milestones.find((entry) => entry.rcl >= gates.requireRcl);
    const reachedByTick =
      milestone?.tick ?? (finalRcl >= gates.requireRcl ? ticks : undefined);
    const byLimit = gates.requireRclBy ?? ticks;

    results.push({
      name: "required-rcl",
      ok: reachedByTick !== undefined && reachedByTick <= byLimit,
      expected: `RCL ${gates.requireRcl} by tick ${byLimit}`,
      actual:
        reachedByTick === undefined
          ? `final RCL ${finalRcl}`
          : `tick ${reachedByTick}`,
      targetRcl: gates.requireRcl,
      byTick: byLimit,
      reachedTick: reachedByTick,
    });
  }

  return results;
}

function normalizeSimulationSeeds({
  seed = "screeps-bounty-arena",
  roomSeed,
  spawnSeed,
  spawnConfig = "balanced",
}) {
  return {
    baseSeed: seed,
    roomSeed: roomSeed || `${seed}:room`,
    spawnSeed: spawnSeed || `${seed}:spawn`,
    spawnConfig,
  };
}

function nextSpawnCost(rng, spawnConfig) {
  const profiles = {
    conservative: [200, 200, 250],
    balanced: [200, 250, 300],
    aggressive: [250, 300, 350],
  };
  assertValidSpawnConfig(spawnConfig);
  const costs = profiles[spawnConfig];
  return costs[Math.floor(rng() * costs.length)];
}

function assertValidSpawnConfig(spawnConfig) {
  if (!VALID_SPAWN_CONFIGS.includes(spawnConfig)) {
    throw new Error(
      `Invalid spawn-config '${spawnConfig}'. Expected one of: ${VALID_SPAWN_CONFIGS.join(", ")}.`,
    );
  }
}

function desiredCreepsForRcl(rcl) {
  return Math.min(3 + rcl, 12);
}

function progressForNextRcl(rcl) {
  return (
    [0, 200, 450, 900, 1600, 2800, 5000, 9000][rcl] ?? Number.POSITIVE_INFINITY
  );
}

export function formatMarkdownReport(result) {
  const lines = [
    `## Screeps Simulation Report`,
    ``,
    `> Trust level: **${result.trustLevel ?? "smoke"}**. ${result.caveat ?? "Offline smoke model only."}`,
    ``,
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Ticks | ${result.ticks} |`,
    `| Seed | \`${result.seed}\` |`,
    `| Fixture | ${result.fixture ? `\`${result.fixture.name}\`` : "none"} |`,
    `| Room seed | \`${result.seeds.roomSeed}\` |`,
    `| Spawn seed | \`${result.seeds.spawnSeed}\` |`,
    `| Spawn config | \`${result.seeds.spawnConfig}\` |`,
    `| Model | \`${result.simulationModel ?? "offline-smoke-v1"}\` |`,
    `| OK | ${result.ok ? "yes" : "no"} |`,
    `| Final RCL | ${result.final.rcl} |`,
    `| Energy capacity | ${result.final.energyCapacity} |`,
    `| Creep count | ${result.final.creeps} |`,
    `| Failures | ${result.failures.length} |`,
    ``,
    `### Gates`,
  ];

  if (result.gates?.length) {
    for (const gate of result.gates) {
      lines.push(
        `- ${gate.ok ? "PASS" : "FAIL"} ${gate.name}: expected ${gate.expected}, actual ${gate.actual}.`,
      );
    }
  } else {
    lines.push("- No explicit gates configured.");
  }

  lines.push(``, `### Milestones`);

  if (result.milestones.length) {
    for (const milestone of result.milestones) {
      lines.push(
        `- Tick ${milestone.tick}: reached RCL ${milestone.rcl} with ${milestone.creeps} creeps and ${milestone.energyCapacity} energy capacity.`,
      );
    }
  } else {
    lines.push("- No RCL milestones reached.");
  }

  lines.push(``, `### Failures`);
  if (result.failures.length) {
    for (const failure of result.failures) {
      lines.push(`- Tick ${failure.tick}: ${failure.reason}`);
    }
  } else {
    lines.push("- None.");
  }

  if (result.diagnostics) {
    const d = result.diagnostics;
    lines.push(
      ``,
      `### Diagnostics (failed gates)`,
      `- Failed gates: ${d.failedGates.join(", ")}`,
      `- Final tick: ${d.finalTick}`,
      `- Final RCL: ${d.finalRcl}`,
      `- Controller progress: ${d.finalProgress}`,
      `- Energy: ${d.finalEnergy}`,
      `- Creep count: ${d.creepCount}`,
      `- Spawn attempts: ${d.spawnAttempts}`,
      `- Spawn successes: ${d.spawnSuccesses}`,
    );
    if (d.lastEvents?.length) {
      lines.push(`- Recent events:`);
      for (const evt of d.lastEvents) {
        lines.push(`  - ${evt}`);
      }
    }
  }

  return lines.join("\n");
}

function formatSummary(result) {
  const lines = [
    `Screeps Bounty Arena offline simulation`,
    `trust level: ${result.trustLevel}`,
    `caveat: ${result.caveat}`,
    `ticks: ${result.ticks}`,
    `seed: ${result.seed}`,
    `fixture: ${result.fixture?.name ?? "none"}`,
    `room seed: ${result.seeds.roomSeed}`,
    `spawn seed: ${result.seeds.spawnSeed}`,
    `spawn config: ${result.seeds.spawnConfig}`,
    `ok: ${result.ok}`,
    `final RCL: ${result.final.rcl}`,
    `creeps: ${result.final.creeps}`,
    `energy capacity: ${result.final.energyCapacity}`,
  ];

  if (result.gates?.length) {
    lines.push("gates:");
    for (const gate of result.gates) {
      lines.push(
        `- ${gate.ok ? "PASS" : "FAIL"} ${gate.name}: expected ${gate.expected}, actual ${gate.actual}`,
      );
    }
  }

  if (result.milestones.length) {
    lines.push("milestones:");
    for (const milestone of result.milestones) {
      lines.push(`- tick ${milestone.tick}: reached RCL ${milestone.rcl}`);
    }
  }

  if (result.failures.length) {
    lines.push("failures:");
    for (const failure of result.failures) {
      lines.push(`- tick ${failure.tick}: ${failure.reason}`);
    }
  }

  return lines.join("\n");
}

function hashSeed(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(seedFn) {
  let a = seedFn();
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
