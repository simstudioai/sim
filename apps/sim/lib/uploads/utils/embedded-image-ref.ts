/**
 * The grammar of a markdown-embedded workspace image reference, shared by the frontend renderer
 * (which rewrites one `src` at a time) and the server (which scans a whole document for the
 * referenced-by-doc gate and the export bundler). Both go through {@link extractEmbeddedFileRef} so
 * the set the client links and the set the server authorizes can never drift apart.
 *
 * Pure and isomorphic — no DOM, Node, or DB imports — so it is safe to import from both client and
 * server code.
 */

/** A reference parsed from an embed `src`: a workspace storage key, a workspace file id, or neither. */
export type EmbeddedFileRef = { key: string } | { fileId: string } | null

/** Hard cap on embedded images resolved from one document — bounds export bundles and the cascade. */
export const MAX_EMBEDDED_IMAGES = 50

/**
 * Candidate embed URL substrings in document text: a serve URL, a view URL, or the in-app workspace
 * path. The captured run stops at whitespace/quote/paren/angle/query so authoritative parsing is left
 * to {@link extractEmbeddedFileRef}.
 */
const EMBED_URL_RE =
  /(?:\/api\/files\/(?:serve|view)\/|\/workspace\/[A-Za-z0-9-]+\/files\/)[^\s)"'<>?]*/g

/**
 * Parse a single embed `src` into the workspace file it references, normalizing the spellings the
 * editor and file agent produce: `/api/files/serve/<key>` (incl. `s3/`/`blob/` prefixes), `/api/files/view/<id>`,
 * and the in-app path `/workspace/<wsId>/files/<id>`. Returns null for absolute, `data:`, or non-workspace
 * URLs (e.g. public `profile-pictures/` assets), which render as-is.
 */
export function extractEmbeddedFileRef(src: string): EmbeddedFileRef {
  try {
    const parsed = new URL(src, 'http://placeholder')
    if (parsed.origin !== 'http://placeholder') return null
    const segs = parsed.pathname.split('/')
    if (segs[1] === 'api' && segs[2] === 'files' && segs[3] === 'serve') {
      let keySegs = segs.slice(4)
      if (keySegs[0] === 's3' || keySegs[0] === 'blob') keySegs = keySegs.slice(1)
      const raw = keySegs.join('/')
      if (!raw) return null
      const key = decodeURIComponent(raw)
      return key.startsWith('workspace/') ? { key } : null
    }
    if (segs[1] === 'api' && segs[2] === 'files' && segs[3] === 'view' && segs[4]) {
      return { fileId: segs[4] }
    }
    if (segs[1] === 'workspace' && segs[3] === 'files' && segs[4]) {
      return { fileId: segs[4] }
    }
    return null
  } catch {
    return null
  }
}

/**
 * The de-duplicated keys and ids embedded in `content`, bounded to {@link MAX_EMBEDDED_IMAGES} unique
 * references **combined** (keys + ids). Every candidate URL is interpreted by {@link extractEmbeddedFileRef},
 * so this is exactly the set the frontend rewrites — the server's referenced-by-doc gate and the export
 * bundler share one grammar.
 */
export function extractEmbeddedFileRefs(content: string): { keys: string[]; ids: string[] } {
  const keys = new Set<string>()
  const ids = new Set<string>()
  for (const match of content.matchAll(EMBED_URL_RE)) {
    const ref = extractEmbeddedFileRef(match[0])
    if (!ref) continue
    if ('key' in ref) keys.add(ref.key)
    else ids.add(ref.fileId)
    if (keys.size + ids.size >= MAX_EMBEDDED_IMAGES) break
  }
  return { keys: [...keys], ids: [...ids] }
}
