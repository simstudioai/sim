/**
 * The grammar of a markup-embedded workspace image reference: how one `src` maps to the workspace
 * file it points at ({@link extractEmbeddedFileRef}), and how to find the `src` values in a raw HTML
 * fragment ({@link extractImgSrcs}). Shared by the frontend renderer (which rewrites one `src` at a
 * time), the clipboard handlers, and the server-side document scan, so the set the client links and
 * the set the server authorizes can never drift apart.
 *
 * Pure and isomorphic — no DOM, Node, or DB imports — so it is safe to import from both client and
 * server code.
 */

/** A reference parsed from an embed `src`: a workspace storage key, a workspace file id, or neither. */
export type EmbeddedFileRef = { key: string } | { fileId: string } | null

/**
 * The stored id behind the spelling a document used. Embedded refs retain ids exactly as written so
 * export rewriting can find the original URL, while storage and inline routes use the decoded id.
 * Decode exactly once so malformed or double-encoded spellings continue to fail closed.
 */
export function storedFileId(spelledId: string): string {
  try {
    return decodeURIComponent(spelledId)
  } catch {
    return spelledId
  }
}

/**
 * Parse a single embed `src` into the workspace file it references, normalizing the spellings the
 * editor and file agent produce: `/api/files/serve/<key>` (incl. `s3/`/`blob/`/`gcs/` prefixes), `/api/files/view/<id>`,
 * and the in-app path `/workspace/<wsId>/files/<id>`. Returns null for absolute, `data:`, or non-workspace
 * URLs (e.g. public `profile-pictures/` assets), which render as-is.
 *
 * A key is percent-decoded — it is matched against stored keys. An id is returned exactly as it is
 * spelled in the `src`, because the export bundler rewrites embeds by searching the document for
 * that spelling; handing it a decoded id it cannot find would bundle an asset and leave the markdown
 * pointing at the API URL, which renders as a broken image offline.
 */
export function extractEmbeddedFileRef(src: string): EmbeddedFileRef {
  try {
    const parsed = new URL(src, 'http://placeholder')
    if (parsed.origin !== 'http://placeholder') return null
    const segs = parsed.pathname.split('/')
    if (segs[1] === 'api' && segs[2] === 'files' && segs[3] === 'serve') {
      let keySegs = segs.slice(4)
      if (keySegs[0] === 's3' || keySegs[0] === 'blob' || keySegs[0] === 'gcs') {
        keySegs = keySegs.slice(1)
      }
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
 * Matches `<img>` `src` attribute values: double-quoted, single-quoted, or (validly) unquoted per
 * the HTML spec — the browser's own clipboard serialization always quotes it, but other producers
 * of `text/html` are not obligated to.
 */
const IMG_SRC_RE = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi

/** Every `<img>` `src` in `html`, in document order — duplicates included. */
export function extractImgSrcs(html: string): string[] {
  const srcs: string[] = []
  for (const match of html.matchAll(IMG_SRC_RE)) {
    const src = match[1] ?? match[2] ?? match[3]
    if (src) srcs.push(src)
  }
  return srcs
}
