let n = 0;
export function uid(prefix: string): string {
  n += 1;
  return `${prefix}_${Date.now().toString(36)}${n.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
