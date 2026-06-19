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
  if (!match) return { frontmatter: bom, body: rest }
  return { frontmatter: bom + match[0], body: rest.slice(match[0].length) }
}

export function applyFrontmatter(frontmatter: string, body: string): string {
  return frontmatter + body
}

/**
 * Normalize a user-entered link target: prefix a bare domain with `https://` so it doesn't resolve
 * as an in-app relative URL, while leaving already-qualified, relative, and protocol-relative URLs
 * intact. Dangerous schemes (`javascript:`, `data:`, `vbscript:`, `file:`) are rejected outright
 * rather than mangled into a broken `https://javascript:…`.
 */
export function normalizeLinkHref(href: string): string {
  const trimmed = href.trim()
  if (!trimmed) return ''
  if (/^(?:javascript|data|vbscript|file):/i.test(trimmed)) return ''
  if (/^(?:https?:\/\/|mailto:|tel:|[#?])/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (trimmed.startsWith('/')) return trimmed
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

/**
 * Cleans up serializer output: restores callout markers the serializer backslash-escapes
 * (`> \[!NOTE\]` → `> [!NOTE]`) and trims the spurious leading blank line the table
 * serializer emits, plus trailing blank lines.
 */
export function postProcessSerializedMarkdown(markdown: string): string {
  return markdown
    .replace(ESCAPED_CALLOUT_REGEX, '$1[!$2]')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n')
}
