/**
 * HTML escaping for every Studio page (docs/CONTENT_STUDIO_DESIGN.md §8, §9.1):
 * the five characters that can end a text node or a quoted attribute. Moved
 * unchanged from `app.ts` by Content Studio S5, which re-exports it, so the S5
 * views and S4's pages share one function.
 */

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
