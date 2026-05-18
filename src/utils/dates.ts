export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  const cur = parseDate(start);
  const last = parseDate(end);
  while (cur <= last) {
    days.push(formatDate(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}
