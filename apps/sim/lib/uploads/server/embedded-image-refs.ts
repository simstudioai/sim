/**
 * Finds the workspace files a markdown document embeds as images.
 *
 * Lives under `server/` rather than beside its pure sibling in `lib/uploads/utils` so that `marked`
 * stays out of the client bundles that import the single-`src` grammar.
 */
import { Parser } from 'htmlparser2'
import { Marked, type Token } from 'marked'
import {
  type EmbeddedFileRef,
  extractEmbeddedFileRef,
  storedFileId,
} from '@/lib/uploads/utils/embedded-image-ref'

/** Hard cap on embedded images collected for a bulk export bundle. */
export const MAX_EMBEDDED_IMAGES = 50

/**
 * A parser of this module's own, not the `marked` singleton: the public share's referenced-by-doc
 * gate authorizes against what this returns, and a global `marked.use()` elsewhere in the process
 * must not be able to redefine an authorization boundary.
 */
const markdown = new Marked()

/** Children hang off `tokens`, except on tables (per cell) and lists (per item). */
function childrenOf(token: Token): Token[] {
  if (token.type === 'table') {
    return [...token.header, ...token.rows.flat()].flatMap((cell) => cell.tokens)
  }
  if (token.type === 'list') return token.items
  return 'tokens' in token && token.tokens ? token.tokens : []
}

/**
 * The de-duplicated workspace keys and file ids `content` embeds **as images**, bounded to
 * {@link MAX_EMBEDDED_IMAGES} references combined. Covers markdown images (`![alt](src)`, including
 * the reference form the lexer resolves) and `<img>` tags in raw HTML.
 *
 * Parsed with the markdown lexer rather than scanned as text, because only a parser can tell an
 * embed from a mention. A document *about* the files API — prose, an inline `` `/api/files/view/{id}` ``,
 * a fenced request sample — is full of strings that look like embed URLs but display nothing, and
 * counting them as assets made every such document export as a zip with an empty `assets/` folder.
 * Links are excluded for the same reason: a link is navigated to, not displayed, so it is neither an
 * exportable asset nor something a document's public share should cascade to.
 */
export function extractEmbeddedFileRefs(content: string): { keys: string[]; ids: string[] } {
  const keys = new Set<string>()
  const ids = new Set<string>()
  visitEmbeddedFileRefs(content, (ref) => {
    if ('key' in ref) keys.add(ref.key)
    else ids.add(ref.fileId)
    return keys.size + ids.size >= MAX_EMBEDDED_IMAGES
  })
  return { keys: [...keys], ids: [...ids] }
}

/** Matches one stored image reference without imposing a bulk export's asset-count limit. */
export function hasEmbeddedFileRef(content: string, target: NonNullable<EmbeddedFileRef>): boolean {
  return visitEmbeddedFileRefs(content, (ref) =>
    'fileId' in target
      ? 'fileId' in ref && storedFileId(ref.fileId) === target.fileId
      : 'key' in ref && ref.key === target.key
  )
}

/** Stops at the first accepted reference; callers bound document bytes before parsing. */
function visitEmbeddedFileRefs(
  content: string,
  visit: (ref: NonNullable<EmbeddedFileRef>) => boolean
): boolean {
  const record = (src: string) => {
    const ref = extractEmbeddedFileRef(src)
    return ref !== null && visit(ref)
  }

  let tokens: Token[]
  try {
    tokens = markdown.lexer(content)
  } catch {
    return false
  }

  let sourceDepth = 0
  let matched = false
  /** A single streaming parser preserves raw HTML context across inline Markdown tokens. */
  const htmlParser = new Parser({
    onopentag(name, attributes) {
      if (
        sourceDepth > 0 ||
        name === 'pre' ||
        name === 'code' ||
        name === 'kbd' ||
        name === 'script' ||
        name === 'style'
      ) {
        sourceDepth++
      } else if (name === 'img' && attributes.src && record(attributes.src)) {
        matched = true
        htmlParser.pause()
      }
    },
    onclosetag() {
      if (sourceDepth > 0) sourceDepth--
    },
  })

  /** An explicit stack avoids marked.walkTokens' accumulating result array. */
  const stack = [...tokens].reverse()
  while (stack.length > 0) {
    const token = stack.pop() as Token
    if (token.type === 'image' && sourceDepth === 0 && record(token.href)) return true
    if (token.type === 'html') {
      htmlParser.write(token.text)
      if (matched) return true
    }
    const children = childrenOf(token)
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }

  htmlParser.end()
  return matched
}
