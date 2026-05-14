import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function runSim(args: string[]): Record<string, unknown> {
  try {
    const output = execFileSync('node', ['scripts/simulate.mjs', ...args], {
      encoding: 'utf8',
    });
    return JSON.parse(output) as Record<string, unknown>;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    if (e.stdout) {
      return JSON.parse(e.stdout) as Record<string, unknown>;
    }
    throw err;
  }
}

function runSimMarkdown(args: string[]): string {
  try {
    return execFileSync('node', ['scripts/simulate.mjs', ...args], {
      encoding: 'utf8',
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string };
    if (e.stdout) return e.stdout;
    throw err;
  }
}

describe('simulation failure diagnostics', () => {
  it('includes diagnostics when a required-RCL gate fails', () => {
    const result = runSim([
      '--ticks', '50',
      '--seed', 'diag-fail-test',
      '--require-rcl', '5',
      '--require-rcl-by', '50',
      '--json',
    ]);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toBeDefined();

    const diag = result.diagnostics as Record<string, unknown>;
    expect((diag.failedGates as string[])).toContain('required-rcl');
    expect(diag.finalTick).toBe(50);
    expect(typeof diag.finalRcl).toBe('number');
    expect(typeof diag.finalProgress).toBe('number');
    expect(typeof diag.creepCount).toBe('number');
    expect(typeof diag.spawnAttempts).toBe('number');
    expect(typeof diag.spawnSuccesses).toBe('number');
  });

  it('diagnostics are undefined when all gates pass', () => {
    const result = runSim([
      '--ticks', '100',
      '--seed', 'diag-pass-test',
      '--require-rcl', '1',
      '--json',
    ]);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toBeUndefined();
  });

  it('max-failures gate reports actual failure count', () => {
    const result = runSim([
      '--ticks', '100',
      '--seed', 'diag-maxfail',
      '--max-failures', '0',
      '--json',
    ]);

    const gates = result.gates as Array<Record<string, unknown>>;
    expect(gates[0].name).toBe('max-failures');
    expect(gates[0].actual).toBe((result.failures as unknown[]).length);
  });

  it('markdown report includes diagnostics section when gates fail', () => {
    const md = runSimMarkdown([
      '--ticks', '30',
      '--seed', 'diag-md-test',
      '--require-rcl', '8',
      '--require-rcl-by', '30',
      '--markdown',
    ]);

    expect(md).toContain('### Diagnostics (failed gates)');
    expect(md).toContain('Failed gates:');
    expect(md).toContain('Final tick:');
    expect(md).toContain('Final RCL:');
    expect(md).toContain('Spawn attempts:');
  });

  it('markdown report omits diagnostics when all gates pass', () => {
    const md = runSimMarkdown([
      '--ticks', '100',
      '--seed', 'diag-md-pass',
      '--require-rcl', '2',
      '--require-rcl-by', '1000',
      '--markdown',
    ]);

    expect(md).not.toContain('### Diagnostics');
  });

  it('tracks spawn attempts and successes in diagnostics on failure', () => {
    const result = runSim([
      '--ticks', '500',
      '--seed', 'diag-spawn-tracking',
      '--require-rcl', '9',
      '--require-rcl-by', '500',
      '--json',
    ]);

    const diag = result.diagnostics as Record<string, unknown>;
    expect(diag).toBeDefined();
    expect(diag.spawnAttempts as number).toBeGreaterThan(0);
    expect(diag.spawnSuccesses as number).toBeGreaterThan(0);
    expect(diag.spawnAttempts as number).toBeGreaterThanOrEqual(
      diag.spawnSuccesses as number,
    );
  });

  it('captures last events including RCL milestones', () => {
    const result = runSim([
      '--ticks', '500',
      '--seed', 'diag-events',
      '--require-rcl', '9',
      '--require-rcl-by', '500',
      '--json',
    ]);

    const diag = result.diagnostics as Record<string, unknown>;
    expect(diag).toBeDefined();
    const events = diag.lastEvents as string[];
    expect(events.length).toBeGreaterThan(0);
    const rclEvents = events.filter((e: string) => e.includes('[RCL]'));
    expect(rclEvents.length).toBeGreaterThan(0);
  });
});
