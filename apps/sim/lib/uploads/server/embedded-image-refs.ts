/**
 * Finds the workspace files a markdown document embeds as images.
 *
 * Lives under `server/` rather than beside its pure sibling in `lib/uploads/utils` so that `marked`
 * stays out of the client bundles that import the single-`src` grammar.
 */
import { Marked, type Token } from 'marked'
import { extractEmbeddedFileRef, extractImgSrcs } from '@/lib/uploads/utils/embedded-image-ref'

/** Hard cap on embedded images resolved from one document — bounds export bundles and the share cascade. */
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
  const atCap = () => keys.size + ids.size >= MAX_EMBEDDED_IMAGES

  const record = (src: string) => {
    if (atCap()) return
    const ref = extractEmbeddedFileRef(src)
    if (!ref) return
    if ('key' in ref) keys.add(ref.key)
    else ids.add(ref.fileId)
  }

  let tokens: Token[]
  try {
    tokens = markdown.lexer(content)
  } catch {
    // Best effort: a document that fails to lex must never block an export or a share.
    return { keys: [], ids: [] }
  }

  // Walked explicitly rather than with `marked.walkTokens`, which concatenates its callback's return
  // value into an accumulator once per token and so costs O(n²): a 254 KB document measured 5.4s of
  // blocked event loop versus 14ms here, on a path anonymous share traffic reaches.
  const stack = [...tokens].reverse()
  while (stack.length > 0 && !atCap()) {
    const token = stack.pop() as Token
    if (token.type === 'image') record(token.href)
    else if (token.type === 'html') {
      // `<pre>`/`<script>`/`<style>` contents are shown as source, not rendered. A block tag marks
      // that with `pre`, an inline one with `inRawBlock`.
      const shownAsSource = 'pre' in token ? token.pre : token.inRawBlock
      if (!shownAsSource) for (const src of extractImgSrcs(token.text)) record(src)
    }
    const children = childrenOf(token)
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }

  return { keys: [...keys], ids: [...ids] }
}
