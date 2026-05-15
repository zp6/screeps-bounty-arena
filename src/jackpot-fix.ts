// Fix for jackpot regression (#78)
// Ensure jackpot is properly reset at round boundaries

export function resetJackpotOnNewRound(currentRound: number, newRound: number): void {
  if (newRound > currentRound) {
    Memory.jackpot = 0;
  }
}

export function safeAddJackpot(amount: number): void {
  const newVal = (Memory.jackpot || 0) + amount;
  Memory.jackpot = Math.min(newVal, Number.MAX_SAFE_INTEGER);
}
