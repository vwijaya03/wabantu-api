/**
 * Parse simple duration strings ("15m", "30d", "1h") into seconds.
 * Used for SESSION_TTL — JWT itself accepts the string directly.
 */
export function parseDurationToSeconds(input: string): number {
  const m = input.match(/^(\d+)\s*(ms|s|m|h|d|w)$/);
  if (!m) {
    const asNum = Number(input);
    if (Number.isFinite(asNum)) return Math.max(1, Math.floor(asNum));
    throw new Error(`Invalid duration: ${input}`);
  }
  const value = Number(m[1]);
  const unit = m[2];
  const multipliers: Record<string, number> = {
    ms: 1 / 1000,
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
  };
  return Math.max(1, Math.round(value * multipliers[unit]));
}
