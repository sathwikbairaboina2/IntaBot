export function formatSlot(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(iso));
}

export function summarise(caption: string, max: number): string {
  if (caption.length === 0) return "(no caption yet)";
  if (caption.length <= max) return caption;
  const cut = caption.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > 0 ? boundary : max)}…`;
}
