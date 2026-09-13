export const localDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export interface LocalScheduleDay { date: string; weekday: string; dateLabel: string; today: boolean; }

export function localWeek(now: Date): LocalScheduleDay[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay(), 12);
  const today = localDateKey(now);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start); date.setDate(start.getDate() + index);
    return {
      date: localDateKey(date),
      weekday: date.toLocaleDateString([], { weekday: "short" }),
      dateLabel: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      today: localDateKey(date) === today
    };
  });
}

export function seasonScheduleTitle(date: Date): string {
  const names = ["Winter", "Spring", "Summer", "Fall"] as const;
  return `${names[Math.floor(date.getMonth() / 3)]} ${date.getFullYear()} Season Schedule`;
}

export const releaseHasPassed = (releaseAt: string, now: Date): boolean => {
  const timestamp = Date.parse(releaseAt);
  return Number.isFinite(timestamp) && timestamp < now.getTime();
};

export const timezoneOffsetEast = (date: Date): number => -date.getTimezoneOffset();

