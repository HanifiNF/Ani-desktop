export const localDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export interface LocalScheduleDay { date: string; weekday: string; dayOfMonth: string; dateLabel: string; today: boolean; }

/** Two days back keep recent releases in reach for catching up; seven days give every weekday one tab. */
const DAYS_BACK = 2, DAYS_SHOWN = 7;

/** A rolling strip of local days around today, in date order. */
export function scheduleDays(now: Date): LocalScheduleDay[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAYS_BACK, 12);
  const today = localDateKey(now);
  return Array.from({ length: DAYS_SHOWN }, (_, index) => {
    const date = new Date(start); date.setDate(start.getDate() + index);
    return {
      date: localDateKey(date),
      weekday: date.toLocaleDateString([], { weekday: "short" }),
      dayOfMonth: String(date.getDate()),
      dateLabel: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      today: localDateKey(date) === today
    };
  });
}

/**
 * The selected date after the local day changes: a selection on the old today follows to the new one,
 * another day stays while the strip still shows it, and one that fell off the strip returns to today.
 */
export function selectionAfterDayChange(selected: string, previousToday: string, now: Date): string {
  const today = localDateKey(now);
  return selected !== previousToday && scheduleDays(now).some((day) => day.date === selected) ? selected : today;
}

export const msUntilNextLocalDay = (now: Date): number =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();

export function seasonLabel(date: Date): string {
  const names = ["Winter", "Spring", "Summer", "Fall"] as const;
  return `${names[Math.floor(date.getMonth() / 3)]} ${date.getFullYear()}`;
}

export const seasonScheduleTitle = (date: Date): string => `${seasonLabel(date)} Season Schedule`;

/** "in 1h 30m" style countdown to a release; empty once it has passed. Minutes are rounded up so "in 1m" never reads as "in 0m". */
export function releaseCountdown(releaseAt: string, now: Date): string {
  const remaining = Date.parse(releaseAt) - now.getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) return "";
  const minutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) return `in ${Math.round(hours / 24)} days`;
  if (hours >= 1) return minutes % 60 && hours < 10 ? `in ${hours}h ${minutes % 60}m` : `in ${hours}h`;
  return `in ${minutes}m`;
}

export const releaseHasPassed = (releaseAt: string, now: Date): boolean => {
  const timestamp = Date.parse(releaseAt);
  return Number.isFinite(timestamp) && timestamp < now.getTime();
};

export const timezoneOffsetEast = (date: Date): number => -date.getTimezoneOffset();


/**
 * How many leading chips fit on one line of `width`, leaving room for a "+n" chip whenever some are left over.
 * An unmeasured line (width 0, as in a test DOM) fits everything.
 */
export function chipsThatFit(width: number, chipWidths: number[], gap: number, moreWidth: number): number {
  if (width <= 0) return chipWidths.length;
  let used = 0;
  for (let index = 0; index < chipWidths.length; index++) {
    const next = used + (index ? gap : 0) + chipWidths[index];
    const last = index === chipWidths.length - 1;
    if ((last ? next : next + gap + moreWidth) > width) return index;
    used = next;
  }
  return chipWidths.length;
}
