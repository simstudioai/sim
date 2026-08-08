/**
 * Safety utilities for untrusted document content rendered into the app origin
 * (PPTX, DOCX, and other previews).
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Returns true only for absolute URLs with an allowed protocol.
 */
export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Neutralizes anchors rendered from untrusted document content (e.g. docx-preview,
 * which copies an external-relationship `Target` straight into `href` with no scheme
 * check). Same-document fragment links (`#bookmark`) are left intact; anything else
 * that isn't http/https/mailto has its `href` stripped so the anchor can't navigate.
 * Surviving external links get `rel="noopener noreferrer"` to block tabnabbing.
 */
export function sanitizeRenderedHyperlinks(root: ParentNode): void {
  for (const anchor of root.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? ''
    if (href.startsWith('#')) continue
    if (isAllowedExternalUrl(href)) {
      anchor.setAttribute('rel', 'noopener noreferrer')
      continue
    }
    anchor.removeAttribute('href')
  }
}

/**
 * Removes embedded browsing contexts from rendered document content. A renderer-injected
 * `<iframe srcdoc>` inherits the app origin, so any script it carries runs with the
 * victim's session. Defense in depth — renderers are also configured not to emit frames.
 */
export function stripEmbeddedFrames(root: ParentNode): void {
  for (const element of root.querySelectorAll('iframe, object, embed')) {
    element.remove()
  }
}
