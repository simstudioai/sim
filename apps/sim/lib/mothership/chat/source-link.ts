/**
 * Hostname for an external http(s) link, used to fetch its favicon. Returns
 * null for relative, anchor, mailto, and unparsable hrefs so those keep the
 * plain text treatment.
 */
export function externalLinkHostname(href?: string): string | null {
  if (!href || !/^https?:\/\//i.test(href)) return null
  try {
    return new URL(href).hostname
  } catch {
    return null
  }
}

/** The site a link belongs to: its known site name, else its hostname without `www.`. */
export function linkSiteName(url: string, siteName?: string | null): string {
  return siteName?.trim() || (externalLinkHostname(url) ?? url).replace(/^www\./, '')
}

/**
 * A prose link shares the platform blue and retains a visible keyboard focus outline.
 */
export const PROSE_LINK_CLASS =
  'not-prose [&_strong]:text-inherit [&_em]:text-inherit [&_code]:text-inherit [&_del]:text-inherit text-[var(--brand-blue)] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)]'
