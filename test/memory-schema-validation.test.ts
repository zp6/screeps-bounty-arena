import { beforeEach, describe, expect, it } from 'vitest';

import {
  cleanupDeadCreeps,
  migrateRoomMemory,
  migrateRoomMemoryRecord,
  ROOM_MEMORY_VERSION,
} from '../src/memory';

beforeEach(() => {
  globalThis.Memory = { creeps: {}, rooms: {} };
  globalThis.Game = { time: 1, creeps: {}, spawns: {}, rooms: {} } as GameGlobal;
});

// ---------------------------------------------------------------------------
// Edge-case: corrupted Memory roots
// ---------------------------------------------------------------------------

describe('memory schema validation edge cases', () => {
  // ---- Memory.creeps corruption ----

  it('handles Memory.creeps set to null', () => {
    (Memory as unknown as { creeps: unknown }).creeps = null;
    expect(cleanupDeadCreeps()).toEqual([]);
    expect(Memory.creeps).toEqual({});
  });

  it('handles Memory.creeps set to undefined', () => {
    delete (Memory as Partial<MemoryGlobal>).creeps;
    expect(cleanupDeadCreeps()).toEqual([]);
    expect(Memory.creeps).toEqual({});
  });

  it('handles Memory.creeps set to a number', () => {
    (Memory as unknown as { creeps: unknown }).creeps = 42;
    expect(cleanupDeadCreeps()).toEqual([]);
    expect(Memory.creeps).toEqual({});
  });

  it('handles Memory.creeps set to an array', () => {
    (Memory as unknown as { creeps: unknown }).creeps = [{ role: 'harvester' }];
    expect(cleanupDeadCreeps()).toEqual([]);
    expect(Memory.creeps).toEqual({});
  });

  it('handles Memory.creeps with non-object creep values', () => {
    (Memory as unknown as { creeps: Record<string, unknown> }).creeps = {
      CreepA: 'just-a-string',
      CreepB: 123,
      CreepC: null,
      CreepD: true,
    };
    Game.creeps = {} as Record<string, Creep>;

    // Should not throw — all entries are removed since no live creeps match
    const removed = cleanupDeadCreeps();
    expect(removed.sort()).toEqual(['CreepA', 'CreepB', 'CreepC', 'CreepD']);
    expect(Memory.creeps).toEqual({});
  });

  // ---- Memory.rooms corruption ----

  it('handles Memory.rooms set to null during migrateRoomMemory', () => {
    (Memory as unknown as { rooms: unknown }).rooms = null;
    Game.rooms = { W1N1: {} as Room };

    migrateRoomMemory();

    expect(Memory.rooms).toEqual({
      W1N1: { version: ROOM_MEMORY_VERSION },
    });
  });

  it('throws when Memory.rooms is a non-object string (documented edge case)', () => {
    (Memory as unknown as { rooms: unknown }).rooms = 'bad';
    Game.rooms = { W1N1: {} as Room };

    // The current implementation assigns to Memory.rooms[roomName] which
    // fails on a string — this is a known limitation.
    expect(() => migrateRoomMemory()).toThrow();
  });

  // ---- Room memory shape migration edge cases ----

  it('handles completely empty room memory', () => {
    const result = migrateRoomMemoryRecord({});
    expect(result).toEqual({ version: ROOM_MEMORY_VERSION });
  });

  it('preserves unknown fields from old memory versions', () => {
    const old = {
      version: 0,
      customField: 'preserved',
      nestedData: { a: 1, b: [2, 3] },
    } as Partial<RoomMemory>;

    const result = migrateRoomMemoryRecord(old);
    expect(result.version).toBe(ROOM_MEMORY_VERSION);
    expect((result as Record<string, unknown>).customField).toBe('preserved');
    expect((result as Record<string, unknown>).nestedData).toEqual({ a: 1, b: [2, 3] });
  });

  it('overwrites an outdated version number', () => {
    const result = migrateRoomMemoryRecord({ version: 0 } as Partial<RoomMemory>);
    expect(result.version).toBe(ROOM_MEMORY_VERSION);
  });

  it('keeps version unchanged when already current', () => {
    const result = migrateRoomMemoryRecord({
      version: ROOM_MEMORY_VERSION,
      existing: true,
    } as Partial<RoomMemory>);
    expect(result.version).toBe(ROOM_MEMORY_VERSION);
    expect((result as Record<string, unknown>).existing).toBe(true);
  });

  // ---- Game.rooms edge cases ----

  it('skips rooms not present in Game.rooms', () => {
    Memory.rooms = {
      W1N1: { version: 0 },
      W2N2: { version: 0 },
    };
    Game.rooms = { W1N1: {} as Room };

    migrateRoomMemory();

    // W1N1 gets migrated; W2N2 stays stale since Game.rooms doesn't include it
    expect(Memory.rooms.W1N1).toEqual({ version: ROOM_MEMORY_VERSION });
    expect((Memory.rooms.W2N2 as Record<string, unknown>).version).toBe(0);
  });

  it('handles Game.rooms being empty', () => {
    Game.rooms = {};
    Memory.rooms = { W1N1: { version: 0 } };

    migrateRoomMemory();

    // Existing stale entry is untouched since Game.rooms is empty
    expect((Memory.rooms.W1N1 as Record<string, unknown>).version).toBe(0);
  });

  it('handles Game.rooms being undefined', () => {
    (Game as Partial<GameGlobal>).rooms = undefined;
    Memory.rooms = {};

    expect(() => migrateRoomMemory()).not.toThrow();
  });

  // ---- Creep cleanup with mixed valid/invalid entries ----

  it('removes only dead creeps, keeps live ones intact', () => {
    Memory.creeps = {
      Live: { role: 'harvester' },
      AlsoLive: { role: 'upgrader' },
      Ghost: { role: 'builder' },
    };
    Game.creeps = {
      Live: { name: 'Live' } as Creep,
      AlsoLive: { name: 'AlsoLive' } as Creep,
    };

    const removed = cleanupDeadCreeps();
    expect(removed).toEqual(['Ghost']);
    expect(Object.keys(Memory.creeps).sort()).toEqual(['AlsoLive', 'Live']);
  });

  it('does not throw when Game.creeps is not a record', () => {
    Memory.creeps = { A: { role: 'test' } };
    (Game as unknown as { creeps: unknown }).creeps = null;

    // Should treat non-record Game.creeps as empty
    expect(() => cleanupDeadCreeps()).not.toThrow();
  });
});
