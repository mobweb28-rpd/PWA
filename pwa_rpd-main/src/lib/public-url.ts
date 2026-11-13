/** Only HTTP(S) links/media are accepted from upstream content or CMS input. */
export function publicHttpUrl(value: unknown, base?: string): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}
