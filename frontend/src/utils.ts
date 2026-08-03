export function buildPdfFilename(c: { name: string; createdAt: string }): string {
  const dt = new Date(c.createdAt);
  const date = dt.toISOString().slice(0, 10);
  const time = dt.toISOString().slice(11, 19).replace(/:/g, '');
  const slug = c.name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (/^\d{4}-\d{2}-\d{2}-\d{6}-/.test(slug)) {
    return slug;
  }
  return `${date}-${time}-${slug}`;
}

export function printWithFilename(filename: string): void {
  const prev = document.title;
  document.title = filename;
  window.print();
  document.title = prev;
}

// Strip "(F-uuid, ...)" parentheticals — the IDs already show in finding badges
// and the Evidence References table. Match any alphanumeric tail, not just hex:
// the model sometimes emits non-UUID finding IDs.
export function stripInlineCitations(text: string): string {
  return text
    .replace(/\s*\(([^()]*F-[a-zA-Z0-9-]{6,}[^()]*)\)/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
