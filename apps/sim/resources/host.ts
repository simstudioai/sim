/**
 * Who owns the URL, the router, and the document frame around a resource view.
 *
 * - `page` — owns the URL (may write nuqs keys) and draws breadcrumbs/header chrome.
 * - `panel` — embedded inside a host that owns the URL. MUST NOT write
 *   unnamespaced nuqs keys and draws no breadcrumbs. Views that write params
 *   like `?mode` / `?module` / `?page` / `?q` unconditionally pollute their
 *   host's address bar when embedded; this is the axis that stops it.
 * - `public` — no workspace routes exist. Links resolve to nothing and no
 *   account-scoped affordances are drawn.
 */
export type ResourceHost = 'page' | 'panel' | 'public'

/**
 * Whether this host may write to the address bar. The single place the
 * "embedded views do not own the URL" rule is expressed.
 */
export function hostOwnsUrl(host: ResourceHost): boolean {
  return host === 'page'
}
