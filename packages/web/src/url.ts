/**
 * Resolves a result location for the page. Only the page's own origin is allowed, so a crafted link
 * cannot make the page load and render a document from somewhere else.
 */
export function resolveResultUrl(param: string, pageUrl: string): string {
  const page = new URL(pageUrl);
  const resolved = new URL(param, page);
  if (resolved.origin !== page.origin) throw new Error("result must be on the same origin as this page");
  return resolved.href;
}
