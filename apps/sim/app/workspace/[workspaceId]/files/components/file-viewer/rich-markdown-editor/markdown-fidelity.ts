/**
 * Fidelity helpers that keep markdown TipTap can't model losslessly intact across an edit
 * cycle. YAML frontmatter is held out of the editor entirely (TipTap parses `---` as a
 * thematic break and corrupts it), and a couple of serializer quirks are smoothed over.
 */

const BOM = '\uFEFF'
const FRONTMATTER_REGEX = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n)*/
const ESCAPED_CALLOUT_REGEX = /^(\s*>(?:\s*>)*\s*)\\\[!([A-Za-z]+)\\\]/gm

/**
 * Alternates a code region (fenced block or inline span \u2014 never rewritten) with an inline link whose
 * destination has no title and isn't angle-bracketed. The code branch is listed first so a link inside
 * code is consumed as code and left untouched. The destination stops at `)` / whitespace, so a link
 * carrying a title (`[x](url "t")`) never matches and is preserved verbatim.
 */
const CODE_OR_PLAIN_LINK_REGEX =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)|\[([^\]]+)]\(([^)\s<>]+)\)/g
const HTTP_URL_REGEX = /^https?:\/\/\S+$/i

/**
 * Collapses an autolinked destination back to its bare form: our normalizing serializer rewrites a bare
 * URL or `<url>` autolink to `[url](url)` and a bare email to `[a@b.com](mailto:a@b.com)`, which churns
 * every README's links into explicit-link syntax on the first save. When the visible text already equals
 * the destination (a plain `http(s)` URL, or an email behind `mailto:`), GFM re-autolinks the bare form,
 * so emitting it round-trips identically with a far quieter diff. Links inside code and titled links are
 * left untouched (see {@link CODE_OR_PLAIN_LINK_REGEX}).
 */
function collapseAutolinkedUrls(markdown: string): string {
  return markdown.replace(CODE_OR_PLAIN_LINK_REGEX, (match, code, text, href) => {
    if (code) return code
    if (text === href && HTTP_URL_REGEX.test(href)) return href
    if (href === `mailto:${text}`) return text
    return match
  })
}

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

/** A line that is a bullet/ordered list marker with no content (`-`, `  - `, `1. `). Task items (`- [ ]`) don't match. */
const EMPTY_LIST_ITEM_LINE = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]*$/
/** A fenced code-block delimiter (``` or ~~~), used to leave code interiors untouched. */
const FENCE_DELIMITER = /^[ \t]*(`{3,}|~{3,})/
/** Leading indentation of a line, used to detect whether an empty list item has indented children. */
const LEADING_INDENT = /^[ \t]*/

/**
 * Removes *nested* (indented) empty list-item marker lines from serialized markdown. A nested empty
 * bullet (`  - `) sitting directly under a parent item's text re-parses as a Setext heading underline —
 * silently turning the parent line into an `## heading` and dropping the empty bullet on the next load
 * (a data-corrupting round-trip). Only indented empty items are stripped: a *top-level* empty bullet
 * (`- ` / `1. `) round-trips faithfully (it stays an empty item, never a heading), so it is preserved —
 * a placeholder row or an intentionally-blank imported item is not silently deleted. Lines inside fenced
 * code blocks are left untouched, and an empty item whose next non-blank line is more deeply indented is
 * kept so its children are never orphaned.
 *
 * Operates only on the editor's own serialized output, which uses fenced (never 4-space-indented) code
 * blocks and `\n` newlines — so tracking fences is sufficient and a bare `-` inside an indented code
 * block or a `-\r` line is not a case that can occur here.
 */
function stripEmptyListItemLines(markdown: string): string {
  const lines = markdown.split('\n')
  const kept: string[] = []
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const delimiter = line.match(FENCE_DELIMITER)?.[1]
    if (fence) {
      kept.push(line)
      if (delimiter && delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = null
      continue
    }
    if (delimiter) {
      fence = delimiter
      kept.push(line)
      continue
    }
    const empty = line.match(EMPTY_LIST_ITEM_LINE)
    if (empty) {
      const indent = empty[1].length
      let next = i + 1
      while (next < lines.length && lines[next].trim() === '') next++
      const hasChildren =
        next < lines.length && (lines[next].match(LEADING_INDENT)?.[0].length ?? 0) > indent
      // Strip only nested (indented) empty items — the Setext-underline hazard. A top-level empty item
      // round-trips faithfully and is preserved. Never orphan an item that has more-indented children.
      if (indent > 0 && !hasChildren) continue
    }
    kept.push(line)
  }
  return kept.join('\n')
}

/**
 * Cleans up serializer output: drops empty list-item marker lines that would otherwise corrupt on
 * round-trip ({@link stripEmptyListItemLines}), restores callout markers the serializer
 * backslash-escapes (`> \[!NOTE\]` → `> [!NOTE]`), and collapses trailing blank lines to a single
 * newline. The table serializer's spurious surrounding blank lines are trimmed at the source
 * (PipeSafeTable), so no global leading-newline strip is needed here — avoiding clobbering content
 * that legitimately begins with whitespace.
 */
export function postProcessSerializedMarkdown(markdown: string): string {
  return collapseAutolinkedUrls(
    stripEmptyListItemLines(markdown).replace(ESCAPED_CALLOUT_REGEX, '$1[!$2]')
  ).replace(/\n+$/, '\n')
}
