export function fromUnix(unixSeconds: number): Date {
  return new Date(unixSeconds * 1000);
}

export function relativeTime(unixSeconds: number): string {
  const now = Date.now();
  const delta = Math.max(1, Math.floor((now - unixSeconds * 1000) / 1000));

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of units) {
    if (delta >= size) {
      return formatter.format(-Math.floor(delta / size), unit);
    }
  }
  return "just now";
}
