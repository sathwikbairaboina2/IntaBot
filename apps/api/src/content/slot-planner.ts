import { addDays, format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export interface SlotOptions {
  now: Date;
  timezone: string;
  windows: string[];
  /** ISO instants already scheduled for this account. */
  takenAt: string[];
  minLeadMinutes?: number;
  collisionMinutes?: number;
  horizonDays?: number;
}

const MINUTE = 60_000;

/**
 * Returns the first posting window at least `minLeadMinutes` in the future
 * with no existing post within `collisionMinutes`. Windows are wall-clock
 * times in the account's timezone, so they stay at 09:00 local across a
 * daylight-saving change.
 */
export function nextFreeSlot(opts: SlotOptions): string {
  const {
    now,
    timezone,
    windows,
    takenAt,
    minLeadMinutes = 30,
    collisionMinutes = 30,
    horizonDays = 14,
  } = opts;

  const earliest = now.getTime() + minLeadMinutes * MINUTE;
  const takenMs = takenAt.map((iso) => new Date(iso).getTime());
  const sortedWindows = [...windows].sort();

  for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset += 1) {
    const localDay = format(addDays(toZonedTime(now, timezone), dayOffset), "yyyy-MM-dd");

    for (const window of sortedWindows) {
      const instant = fromZonedTime(`${localDay}T${window}:00`, timezone).getTime();
      if (instant < earliest) continue;

      const collides = takenMs.some((t) => Math.abs(t - instant) < collisionMinutes * MINUTE);
      if (collides) continue;

      return new Date(instant).toISOString();
    }
  }

  throw new Error(`no free slot within ${horizonDays} days`);
}
