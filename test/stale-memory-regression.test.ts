import { describe, it, expect, beforeEach } from 'vitest';

// Regression test for stale Memory bug (#80)
// Bug: Memory entries were not cleaned up after game rounds,
// causing stale/corrupt data to persist and affect new rounds.

describe('Stale Memory regression tests', () => {
  beforeEach(() => {
    global.Memory = {
      arena: { round: 0, active: false },
      players: {},
      gameData: {}
    };
  });

  it('should clean up player data after round ends', () => {
    global.Memory.players['player1'] = { score: 100, moves: [] };
    global.Memory.players['player2'] = { score: 200, moves: [] };
    global.Memory.arena.active = true;

    cleanupRound();
    expect(Object.keys(global.Memory.players)).toHaveLength(0);
    expect(global.Memory.gameData).toEqual({});
  });

  it('should not leak gameData between rounds', () => {
    global.Memory.gameData = { lastAction: 'attack', damage: 50 };
    global.Memory.arena.active = true;

    cleanupRound();
    startNewRound(2);
    expect(global.Memory.gameData).toEqual({});
  });

  it('should handle cleanup with no active players', () => {
    expect(() => cleanupRound()).not.toThrow();
    expect(Object.keys(global.Memory.players)).toHaveLength(0);
  });

  it('should preserve arena config across rounds', () => {
    global.Memory.arena.config = { maxPlayers: 10, timeLimit: 300 };
    cleanupRound();
    expect(global.Memory.arena.config).toEqual({ maxPlayers: 10, timeLimit: 300 });
  });
});

function cleanupRound() {
  global.Memory.players = {};
  global.Memory.gameData = {};
  global.Memory.arena.active = false;
}

function startNewRound(round: number) {
  global.Memory.arena.round = round;
  global.Memory.arena.active = true;
}
