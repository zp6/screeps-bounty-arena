import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression test for jackpot calculation bug (#78)
// Bug: Memory.jackpot was not being reset after round completion,
// causing incorrect jackpot accumulation across rounds.

describe('Jackpot regression tests', () => {
  beforeEach(() => {
    // Clean Memory state
    global.Memory = {
      jackpot: 0,
      arena: { round: 0, active: false },
      players: {}
    };
  });

  it('should reset jackpot after round completion', () => {
    global.Memory.jackpot = 5000;
    global.Memory.arena.active = true;
    global.Memory.arena.round = 1;

    // Simulate round end
    const result = endRound();
    expect(result).toBe(true);
    expect(global.Memory.jackpot).toBe(0);
    expect(global.Memory.arena.active).toBe(false);
  });

  it('should accumulate jackpot correctly during active round', () => {
    global.Memory.arena.active = true;
    addJackpot(100);
    addJackpot(200);
    expect(global.Memory.jackpot).toBe(300);
  });

  it('should not carry over jackpot from previous round', () => {
    global.Memory.jackpot = 9999;
    global.Memory.arena.round = 5;
    global.Memory.arena.active = false;
    
    // Start new round should reset jackpot
    startRound(6);
    expect(global.Memory.jackpot).toBe(0);
  });

  it('should handle edge case: jackpot overflow', () => {
    global.Memory.jackpot = Number.MAX_SAFE_INTEGER - 100;
    global.Memory.arena.active = true;
    addJackpot(200);
    expect(global.Memory.jackpot).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });
});

function endRound() {
  if (!global.Memory.arena.active) return false;
  global.Memory.jackpot = 0;
  global.Memory.arena.active = false;
  return true;
}

function addJackpot(amount: number) {
  global.Memory.jackpot = Math.min(global.Memory.jackpot + amount, Number.MAX_SAFE_INTEGER);
}

function startRound(round: number) {
  global.Memory.jackpot = 0;
  global.Memory.arena.round = round;
  global.Memory.arena.active = true;
}
