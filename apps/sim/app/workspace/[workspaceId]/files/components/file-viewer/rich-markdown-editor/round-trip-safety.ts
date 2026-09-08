import { PASTE_RENDER_THRESHOLDS } from '@sim/utils/paste'
import { decodeHtmlEntities } from '@tiptap/core'
import { Lexer, Marked, type Token, Tokenizer } from 'marked'
import { extractImgSrcs } from '@/lib/uploads/utils/embedded-image-ref'
import { splitFrontmatter } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { serializeMarkdownDocument } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-parse'

/**
 * Constructs the editor drops or mangles in a way that survives a second serialization
 * unchanged — so the idempotency probe below can't see the loss. Each must be matched directly.
 * Image sources and their wrapping links are verified separately against the first serialization.
 *
 * Footnotes, HTML comments, and raw HTML tags (`<div>`, `<details>`, `<kbd>`, …) used to be listed
 * here — the schema had no node for any of them, so they were dropped or stripped (content kept,
 * structure lost). `./raw-markdown-snippet.ts` now holds each construct's exact source text and
 * re-emits it byte-for-byte, so none of them lose data on round-trip and none need a pattern below.
 *
 * - **Hard break inside a heading** (trailing two spaces or a backslash) — the serializer splits
 *   the heading, ejecting the second line into a separate paragraph.
 * - **HTML entity** other than the lowercase canonical `&amp;`/`&lt;`/`&gt;` (e.g. `&copy;`, `&#39;`,
 *   `&nbsp;`, or the uppercase `&AMP;`) — the serializer escapes the `&`, turning the rendered character
 *   into literal entity source. The safe-list is deliberately case-*sensitive*: `@tiptap/markdown` only
 *   round-trips the lowercase forms, so `&AMP;`/`&LT;`/`&GT;` must fall through to read-only rather than
 *   be treated as safe. A bare `&` with no matching `;`-terminated name is left alone (harmless churn).
 */
const STABLE_LOSS_PATTERNS: ReadonlyArray<RegExp> = [
  /^#{1,6}\s.*(?: {2,}|\\)$/m,
  /&(?!(?:amp|lt|gt);)(?:#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/,
]

/**
 * Strip code regions so the patterns above don't fire on code samples: fenced blocks (backtick
 * or tilde, length-matched on the closer so nested fences strip as one unit) and inline code.
 * Indented (4-space) code is deliberately NOT stripped — list/paragraph continuation lines are
 * also indented, and over-stripping would risk missing a real unsafe construct (a false negative,
 * which is worse than the rare false positive of an indented code block opening read-only).
 */
function stripCode(content: string): string {
  return content
    .replace(/^([`~]{3,})[^\n]*\n[\s\S]*?^\1[`~]*[ \t]*$/gm, '')
    .replace(/`+[^`\n]*`+/g, '')
}

const fidelityLexer = new Marked({ gfm: true })
const SUPPORTED_IMAGE_ATTRIBUTES = new Set(['src', 'alt', 'title', 'width', 'height'])

/**
 * Count tags that lose attributes, and exempt image-local &quot; from the text-entity check:
 * the image schema decodes it losslessly, unlike the prose parser.
 */
function inspectHtmlImages(content: string) {
  const images = new Map<string, number>()
  let quotedEntities = 0
  const tokenizer = new Tokenizer()
  new Lexer({ gfm: true, tokenizer })
  const imagePattern = /<img(?=[\s/>])/gi
  for (let image = imagePattern.exec(content); image; image = imagePattern.exec(content)) {
    const tag = tokenizer.tag(content.slice(image.index))
    if (!tag) continue
    imagePattern.lastIndex = image.index + tag.raw.length
    quotedEntities += tag.raw.match(/&quot;/g)?.length ?? 0
    const attributes = tag.raw.slice(4, -1)
    const seen = new Set<string>()
    const pattern = /(?:^|\s)([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g
    for (const attribute of attributes.matchAll(pattern)) {
      const name = attribute[1].toLowerCase()
      const value = attribute[2]
      if (
        !SUPPORTED_IMAGE_ATTRIBUTES.has(name) ||
        seen.has(name) ||
        value === undefined ||
        ((name === 'width' || name === 'height') && (value === '""' || value === "''"))
      ) {
        images.set(tag.raw, (images.get(tag.raw) ?? 0) + 1)
        break
      }
      seen.add(name)
    }
  }
  return { unsupported: images, quotedEntities }
}

function imageSources(token: Token): string[] {
  if (token.type === 'image') return [token.href]
  return token.type === 'html' ? extractImgSrcs(token.raw) : []
}

/**
 * Resolve reference syntax before comparing images and their wrapping links: a stable second
 * serialization cannot reveal first-pass loss. Plain-text link counts are deliberately excluded:
 * adjacent equal link marks can merge losslessly. Task references are conservatively source-only:
 * their parser resolves definitions before a task but loses definitions appearing after it, so
 * rearranging otherwise valid Markdown can silently remove a destination.
 * Table images remain source-only until their parsing and editing paths preserve them consistently.
 * Frontmatter is stored separately, not interpreted as Markdown.
 */
function inspectMarkdownFidelity(content: string) {
  const targets = new Map<string, number>()
  let hasTaskReference = false
  let hasUnsupportedImageContext = false
  let hasQuotedImageMetadata = false
  let preservedQuotes = 0
  const body = splitFrontmatter(content).body
  const add = (kind: 'image' | 'linkedImage', ...destinations: string[]) => {
    const target = JSON.stringify([kind, ...destinations.map(decodeHtmlEntities)])
    targets.set(target, (targets.get(target) ?? 0) + 1)
  }
  fidelityLexer.walkTokens(fidelityLexer.lexer(body), (token) => {
    if (
      token.type === 'image' &&
      [token.raw, token.text, token.title, token.href].some((value) => value?.includes('&quot;'))
    )
      hasQuotedImageMetadata = true
    if (token.type === 'html') preservedQuotes += inspectHtmlImages(token.raw).quotedEntities
    if (token.type === 'code' || token.type === 'codespan')
      preservedQuotes += token.raw.match(/&quot;/g)?.length ?? 0
    if (token.type === 'table') {
      fidelityLexer.walkTokens([token], (child) => {
        if (child.type === 'image' || (child.type === 'html' && /^<img(?=[\s/>])/i.test(child.raw)))
          hasUnsupportedImageContext = true
      })
    }
    for (const src of imageSources(token)) add('image', src)
    if (token.type === 'link') {
      fidelityLexer.walkTokens(token.tokens ?? [], (child) => {
        for (const src of imageSources(child)) add('linkedImage', token.href, src)
      })
    }
    if (token.type === 'list_item' && token.task) {
      for (const child of token.tokens ?? []) {
        if ((child.type === 'text' || child.type === 'paragraph') && child.tokens) {
          fidelityLexer.walkTokens(child.tokens, (inline) => {
            if ((inline.type === 'link' || inline.type === 'image') && inline.raw.endsWith(']')) {
              hasTaskReference = true
            }
          })
        }
      }
    }
  })
  const hasUnsafeQuotes =
    hasQuotedImageMetadata || (body.match(/&quot;/g)?.length ?? 0) > preservedQuotes
  return { targets, hasTaskReference, hasUnsupportedImageContext, hasUnsafeQuotes }
}

/**
 * A link/image reference definition line: `[label]: destination "optional title"` (up to 3 leading
 * spaces). The `(?!\^)` excludes GFM footnote definitions (`[^id]: …`) — those are preserved verbatim
 * by the footnote node and round-trip regardless of whether their reference is present, so they must
 * not be treated as droppable orphan definitions.
 */
const REFERENCE_DEFINITION = /^ {0,3}\[(?!\^)([^\]]+)]:[ \t]+\S[^\n]*$/gm

/** CommonMark reference labels match case-insensitively with internal whitespace collapsed. */
function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * True when `content` defines a link/image reference that nothing uses. A *used* reference inlines
 * losslessly on serialize (`[x][id]` + `[id]: url` → `[x](url)`), but an *unused* definition is dropped
 * entirely — a silent deletion the idempotency probe can't see (the drop happens on the first pass,
 * which is then stable). We open such a file read-only rather than lose the definition on first edit.
 * Conservative: a label counts as used if it appears bracketed anywhere in the body, so the rare
 * inline-text collision errs toward editable, never toward a false read-only.
 */
function hasOrphanReferenceDefinition(content: string): boolean {
  const labels = new Set<string>()
  for (const match of content.matchAll(REFERENCE_DEFINITION)) {
    labels.add(normalizeReferenceLabel(match[1]))
  }
  if (labels.size === 0) return false
  const body = content
    .replace(REFERENCE_DEFINITION, '')
    .replace(/\s+/g, ' ')
    .replace(/\[\s+/g, '[')
    .replace(/\s+\]/g, ']')
    .toLowerCase()
  for (const label of labels) {
    if (!body.includes(`[${label}]`)) return true
  }
  return false
}

/**
 * Whether `content` fits the rich editor's rendering budget and survives its Markdown round-trip
 * without known data loss or autosave churn. A refusal keeps rich preview read-only and offers
 * source editing; the character cap is a performance boundary, separate from fidelity checks.
 *
 * Two complementary checks: known stable-loss constructs are matched directly (the idempotency
 * probe is blind to them), and everything else must reach a fixpoint — `serializeMarkdownDocument(x)`
 * twice in a row must be byte-identical, so the first edit can't churn the file. Lossless
 * normalizations (`_`→`*`, setext→ATX, autolink→inline, loose→tight lists) reach a fixpoint after one
 * pass and are allowed through; genuine churn (a blockquote wrapping a code fence keeps growing) is not.
 */
export function isRoundTripSafe(content: string): boolean {
  if (content.length > PASTE_RENDER_THRESHOLDS.ENHANCED_TEXT_CHARACTERS) return false
  const stripped = stripCode(content)
  if (STABLE_LOSS_PATTERNS.some((pattern) => pattern.test(stripped.replaceAll('&quot;', ''))))
    return false
  if (hasOrphanReferenceDefinition(stripped)) return false
  try {
    const source = inspectMarkdownFidelity(content)
    if (source.hasTaskReference || source.hasUnsupportedImageContext || source.hasUnsafeQuotes)
      return false
    const once = serializeMarkdownDocument(content)
    const preservedImages = inspectHtmlImages(stripCode(once)).unsupported
    for (const [tag, count] of inspectHtmlImages(stripped).unsupported) {
      if ((preservedImages.get(tag) ?? 0) < count) return false
    }
    const serialized = inspectMarkdownFidelity(once)
    for (const [target, count] of source.targets) {
      if ((serialized.targets.get(target) ?? 0) < count) return false
    }
    return serializeMarkdownDocument(once) === once
  } catch {
    return false
  }
}
