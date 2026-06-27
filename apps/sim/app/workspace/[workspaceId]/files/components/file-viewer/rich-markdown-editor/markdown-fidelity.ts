/**
 * Fidelity helpers that keep markdown TipTap can't model losslessly intact across an edit
 * cycle. YAML frontmatter is held out of the editor entirely (TipTap parses `---` as a
 * thematic break and corrupts it), and a couple of serializer quirks are smoothed over.
 */

const BOM = '\uFEFF'
const FRONTMATTER_REGEX = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n)*/
const ESCAPED_CALLOUT_REGEX = /^(\s*>(?:\s*>)*\s*)\\\[!([A-Za-z]+)\\\]/gm

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
 * A leading `---…---` block is YAML frontmatter unless its first content line is markdown rather than
 * a `key:` — so a doc that opens with a `---` thematic break (e.g. a changelog whose next `---` closes
 * the regex) stays in the editor body instead of being held out-of-band and hidden. An empty block
 * (`---\n---`) is still treated as (empty) frontmatter.
 */
function isYamlFrontmatterBlock(block: string): boolean {
  const interior = block.replace(/^---[ \t]*\r?\n/, '')
  for (const rawLine of interior.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    if (line.startsWith('---')) return true
    return /^[A-Za-z0-9_-]+[ \t]*:/.test(line)
  }
  return true
}

export function applyFrontmatter(frontmatter: string, body: string): string {
  return frontmatter + body
}

/** A leading `scheme://` URL (network protocol). */
const SCHEME_URL = /^([a-z][a-z0-9+.-]*):\/\//i
/** A leading `scheme:` token (per the URL grammar). */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i
/** A bare `host:port` (digits after the colon) — looks scheme-like but is really a domain. */
const HOST_PORT = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i

/**
 * Normalize a user-entered link target: prefix a bare domain with `https://` so it doesn't resolve
 * as an in-app relative URL, while leaving already-qualified, relative (`./other.md`, `../doc.md`), and
 * protocol-relative URLs intact. Dangerous schemes are rejected outright rather than trusted or mangled:
 * any `scheme:` without `//` other than `mailto:`/`tel:` (so `javascript:`, `data:`, `vbscript:`,
 * `blob:`, …), and `file://` (local file access). Other network `scheme://` URLs (`http(s)`, `ftp`, …)
 * pass through. A bare `host:port` (digits after the colon) is a domain, not a scheme, so it still gets
 * the `https://` prefix.
 */
export function normalizeLinkHref(href: string): string {
  const trimmed = href.trim()
  if (!trimmed) return ''
  if (/^[#?]/.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (trimmed.startsWith('/')) return trimmed
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed
  if (/^(?:mailto|tel):/i.test(trimmed)) return trimmed
  const schemed = trimmed.match(SCHEME_URL)
  if (schemed) return /^file$/i.test(schemed[1]) ? '' : trimmed
  if (HAS_SCHEME.test(trimmed) && !HOST_PORT.test(trimmed)) return ''
  return `https://${trimmed}`
}

/**
 * Cleans up serializer output: restores callout markers the serializer backslash-escapes
 * (`> \[!NOTE\]` → `> [!NOTE]`) and collapses trailing blank lines to a single newline. The
 * table serializer's spurious surrounding blank lines are trimmed at the source (PipeSafeTable),
 * so no global leading-newline strip is needed here — avoiding clobbering content that legitimately
 * begins with whitespace.
 */
export function postProcessSerializedMarkdown(markdown: string): string {
  return markdown.replace(ESCAPED_CALLOUT_REGEX, '$1[!$2]').replace(/\n+$/, '\n')
}
