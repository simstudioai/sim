/**
 * URL for a domain's favicon via Google's favicon service.
 *
 * @param domain - Bare hostname (e.g. `x.com`), not a full URL
 * @param size - Requested pixel size; request 2x the display size for retina
 */
export function faviconUrl(domain: string, size: number): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`
}
