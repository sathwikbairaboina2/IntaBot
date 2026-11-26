const DAY_MS = 86_400_000;

/** Whole days until the token expires; negative once it has. */
export function tokenDaysLeft(tokenExpiresAt: string, now: Date = new Date()): number {
  return Math.floor((new Date(tokenExpiresAt).getTime() - now.getTime()) / DAY_MS);
}
