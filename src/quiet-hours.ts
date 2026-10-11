export function isQuiet(instant: string, zone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: zone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(instant)),
  );
  return hour >= 22 || hour < 8;
}
