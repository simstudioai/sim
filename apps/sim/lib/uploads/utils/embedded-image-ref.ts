import { parseSimFileReference } from '@/lib/uploads/utils/file-reference'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

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

/** A rejected private reference must not fall back to its credential-bearing URL. */
export type EmbeddedFileResolution =
  | { kind: 'file'; reference: NonNullable<EmbeddedFileRef> }
  | { kind: 'external' }
  | { kind: 'rejected' }

/**
 * Classifies embeds using one grammar for inline authorization and display. Absolute internal
 * references require a caller-supplied trusted origin; without it they remain rejected for SSR.
 */
export function resolveEmbeddedFileRef(
  src: string,
  owner?: EditableFileOwner,
  trustedOrigin?: string
): EmbeddedFileResolution {
  try {
    const value = src.trim()
    if (value.startsWith('sim:file/')) {
      if (!owner) return { kind: 'rejected' }
      const reference = parseSimFileReference(value.slice('sim:file/'.length), owner)
      return reference?.owner?.entityType === owner.entityType &&
        reference.owner.entityId === owner.entityId
        ? { kind: 'file', reference: { fileId: reference.fileId } }
        : { kind: 'rejected' }
    }
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')
    const origin = trustedOrigin ? new URL(trustedOrigin).origin : undefined
    const parsed = new URL(value, origin ?? 'http://placeholder')
    if (absolute && origin && parsed.origin !== origin) return { kind: 'external' }
    const resolved = (reference: NonNullable<EmbeddedFileRef>): EmbeddedFileResolution =>
      absolute && !origin ? { kind: 'rejected' } : { kind: 'file', reference }
    const segs = parsed.pathname.split('/')
    if (segs[1] === 'api' && segs[2] === 'files' && segs[3] === 'serve') {
      let keySegs = segs.slice(4)
      if (keySegs[0] === 's3' || keySegs[0] === 'blob' || keySegs[0] === 'gcs') {
        keySegs = keySegs.slice(1)
      }
      const raw = keySegs.join('/')
      if (!raw) return { kind: 'rejected' }
      const key = decodeURIComponent(raw)
      if (!key.startsWith('workspace/') && !key.startsWith('project/')) return { kind: 'external' }
      return key.startsWith(owner ? `${owner.entityType}/${owner.entityId}/` : 'workspace/')
        ? resolved({ key })
        : { kind: 'rejected' }
    }
    if (segs[1] === 'api' && segs[2] === 'files' && segs[3] === 'view') {
      return segs[4] ? resolved({ fileId: segs[4] }) : { kind: 'rejected' }
    }
    if (segs[1] === 'api' && segs[2] === 'projects' && segs[4] === 'files') {
      return owner?.entityType === 'project' &&
        decodeURIComponent(segs[3]) === owner.entityId &&
        segs[5] &&
        segs[6] === 'content' &&
        segs.length === 7
        ? resolved({ fileId: segs[5] })
        : { kind: 'rejected' }
    }
    if (segs[1] === 'projects' && segs[3] === 'files') {
      return owner?.entityType === 'project' &&
        decodeURIComponent(segs[2]) === owner.entityId &&
        segs[4] &&
        segs.length === 5
        ? resolved({ fileId: segs[4] })
        : { kind: 'rejected' }
    }
    if (segs[1] === 'workspace' && segs[3] === 'files') {
      if (
        !segs[4] ||
        (owner &&
          (owner.entityType !== 'workspace' || decodeURIComponent(segs[2]) !== owner.entityId))
      )
        return { kind: 'rejected' }
      return resolved({ fileId: segs[4] })
    }
    return { kind: 'external' }
  } catch {
    return { kind: 'rejected' }
  }
}

/**
 * Returns stored-key or document-spelled ID references for existing scanners and exporters.
 * Display code uses the full classification so a rejected internal reference cannot pass through.
 */
export function extractEmbeddedFileRef(src: string, owner?: EditableFileOwner): EmbeddedFileRef {
  const result = resolveEmbeddedFileRef(src, owner)
  return result.kind === 'file' ? result.reference : null
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
