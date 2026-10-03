/**
 * Fidelity helpers that keep markdown TipTap can't model losslessly intact across an edit
 * cycle. YAML frontmatter is held out of the editor entirely (TipTap parses `---` as a
 * thematic break and corrupts it), and a couple of serializer quirks are smoothed over.
 */

const BOM = '\uFEFF'
const FRONTMATTER_REGEX = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?=\r?\n|$)(?:\r?\n)*/
const FRONTMATTER_KEY_REGEX = /^(?:[A-Za-z0-9_-]+|'(?:[^']|'')*'|"(?:[^"\\]|\\.)*")[ \t]*:/

export interface SplitMarkdown {
  /** Out-of-band leading prefix (a BOM and/or the frontmatter block), byte-exact, or `''`. */
  frontmatter: string
  body: string
}

/**
 * Splits the leading out-of-band prefix — an optional UTF-8 BOM and YAML frontmatter — from
 * the body. `frontmatter + body` reconstructs the input exactly, so {@link applyFrontmatter}
 * can re-attach it without rewriting any whitespace, and the body never reaches TipTap with a
 * BOM (which would defeat the frontmatter anchor and corrupt it).
 */
export function splitFrontmatter(markdown: string): SplitMarkdown {
  const bom = markdown.startsWith(BOM) ? BOM : ''
  const rest = bom ? markdown.slice(1) : markdown
  const match = rest.match(FRONTMATTER_REGEX)
  if (!match || !isYamlFrontmatterBlock(match[0])) return { frontmatter: bom, body: rest }
  return { frontmatter: bom + match[0], body: rest.slice(match[0].length) }
}

/**
 * Recognize mapping-style metadata without parsing or rewriting its values. Comments can precede
 * a plain or quoted key; comment-only blocks remain visible because they may be Markdown headings
 * between thematic breaks. A genuinely empty block is still treated as frontmatter.
 */
function isYamlFrontmatterBlock(block: string): boolean {
  const interior = block.replace(/^---[ \t]*\r?\n/, '')
  let hasComment = false
  for (const rawLine of interior.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    if (line === '---') return !hasComment
    if (line.startsWith('#')) {
      hasComment = true
      continue
    }
    return FRONTMATTER_KEY_REGEX.test(line)
  }
  return !hasComment
}

export function applyFrontmatter(frontmatter: string, body: string): string {
  return frontmatter + body
}

/** A leading `scheme:` token (per the URL grammar). */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i
/** A bare `host:port` (digits after the colon) — looks scheme-like but is really a domain. */
const HOST_PORT = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i

/**
 * The only schemes a document link may target — an allowlist, because `scheme://` is well-formed for
 * every scheme: rejecting just the ones known to be dangerous leaves the next one through, and
 * `javascript://…` is a valid URL whose `//` run is merely a comment.
 */
const SAFE_SCHEME = /^(?:(?:https?|ftps?):\/\/|(?:mailto|tel):)/i

/**
 * Normalize a user-entered link target: prefix a bare domain with `https://` so it doesn't resolve
 * as an in-app relative URL, while leaving already-qualified, relative (`./other.md`, `../doc.md`), and
 * protocol-relative URLs intact. A scheme is kept only when {@link SAFE_SCHEME} matches; every other
 * one is dropped to `''`, which callers render as inert text rather than a link. A bare `host:port`
 * (digits after the colon) is a domain, not a scheme, so it still gets the `https://` prefix.
 */
export function normalizeLinkHref(href: string): string {
  const trimmed = href.trim()
  if (!trimmed) return ''
  if (/^[#?]/.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (trimmed.startsWith('/')) return trimmed
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed
  if (SAFE_SCHEME.test(trimmed)) return trimmed
  if (HAS_SCHEME.test(trimmed) && !HOST_PORT.test(trimmed)) return ''
  return `https://${trimmed}`
}

/** Normalize the document's final separator without rewriting literal content or interior spacing. */
export function postProcessSerializedMarkdown(markdown: string): string {
  return markdown.replace(/\n+$/, '\n')
}
