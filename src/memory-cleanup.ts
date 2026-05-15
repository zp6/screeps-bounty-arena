// Fix for stale Memory regression (#80)
// Proper Memory cleanup after game rounds

export function cleanupStaleMemory(): void {
  if (!Memory.arena?.active) {
    // Clean up stale player data
    Memory.players = {};
    Memory.gameData = {};
  }
}

export function initCleanMemory(): void {
  if (!Memory.arena) {
    Memory.arena = { round: 0, active: false };
  }
  if (!Memory.players) {
    Memory.players = {};
  }
  if (!Memory.gameData) {
    Memory.gameData = {};
  }
}
