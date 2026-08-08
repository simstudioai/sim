import {
  type EmbeddedFileRef,
  extractEmbeddedFileRef,
} from '@/lib/uploads/utils/embedded-image-ref'
import type { ResourceSource, ShareSource } from '@/resources/source'

/**
 * The file as the renderers see it.
 *
 * Deliberately narrower than the server's `WorkspaceFileRecord`: that type
 * requires a `workspaceId`, and a shared file has none — filling it with a share
 * token is the lie this view was built to delete. Nothing under `file-view`
 * reads a field outside this set.
 */
export interface FileViewRecord {
  id: string
  name: string
  type: string
  /** Storage object key. Empty when the file has no committed bytes yet. */
  key: string
  size: number
  updatedAt: Date
  folderId?: string | null
  /**
   * Where the bytes live when not the default `workspace` store (e.g. chat
   * mothership uploads). Collaborative editing is workspace-only, so the editor
   * reads this to stay solo for anything else.
   */
  storageContext?: 'workspace' | 'mothership'
}

export interface FileContentUrlOptions {
  /** Request the uncompiled source instead of the rendered/compiled bytes. */
  raw?: boolean
  /**
   * Declare the bytes are being rendered, not downloaded, so the server may
   * substitute a browser-renderable derivative for a format no browser decodes
   * (HEIC). Downloads must leave this off — they need the stored bytes.
   */
  preview?: boolean
  /** Content version (e.g. the record's `updatedAt`) — makes the URL cacheable/immutable. */
  version?: string | number
  /** Append a timestamp cache-buster when there is no `version`. */
  bust?: boolean
}

/**
 * Route prefix a share token addresses a file through.
 *
 * A file share exposes exactly one file and grants it under the token itself, so
 * the token alone addresses it. `grantId` still keys the cache scope, because a
 * container share that grants several files under one token addresses each by
 * its own grant — that route family shares the `/content` and `/inline` suffixes
 * and differs only in this prefix.
 */
function shareBase(source: ShareSource<'file'>): string {
  return `/api/files/public/${encodeURIComponent(source.token)}`
}

/**
 * React Query namespace for this file's content reads.
 *
 * Workspace reads keep the workspace id: `useUpdateWorkspaceFileContent`
 * invalidates by it, and a reader keyed on anything else would never see its own
 * save. Share reads have no writer, so they take the source's opaque scope.
 */
export function fileCacheScope(source: ResourceSource<'file'>): string {
  return source.via === 'workspace' ? source.workspaceId : source.cacheScope
}

/** The workspace this file lives in, or `null` when it is only reachable by share token. */
export function fileWorkspaceId(source: ResourceSource<'file'>): string | null {
  return source.via === 'workspace' ? source.workspaceId : null
}

/** Where this file's bytes come from. */
export function fileContentUrl(
  source: ResourceSource<'file'>,
  key: string,
  options?: FileContentUrlOptions
): string {
  if (source.via === 'share') {
    const base = `${shareBase(source)}/content`
    return options?.preview ? `${base}?preview=1` : base
  }

  const base = `/api/files/serve/${encodeURIComponent(key)}?context=workspace`
  const params: string[] = []
  if (options?.version != null) params.push(`v=${encodeURIComponent(String(options.version))}`)
  else if (options?.bust) params.push(`t=${Date.now()}`)
  if (options?.raw) params.push('raw=1')
  if (options?.preview) params.push('preview=1')
  return params.length > 0 ? `${base}&${params.join('&')}` : base
}

export interface ImageDimensions {
  width: number
  height: number
}

/**
 * Optional per-source capability: reserve layout space for an embedded image from its
 * intrinsic size, so it never reflows on load. The workspace source backs this with
 * file-list metadata plus a self-correcting metadata write; a share source has no file
 * list to read and no write to make, so it falls back to on-load measurement (one
 * reflow, no persist).
 */
export interface ImageDimensionsSource {
  /** Intrinsic dimensions for an embedded image `src` if already known — read synchronously at render. */
  getImageDimensions: (src: string | undefined) => ImageDimensions | null
  /**
   * Persist an image's measured intrinsic dimensions (fire-and-forget). Overwrites a stored value that
   * disagrees so a stale size self-corrects; a no-op only when the stored value already matches.
   */
  reportImageDimensions: (src: string | undefined, dimensions: ImageDimensions) => void
}

/** The capability for a source that resolves no dimensions. Module scope, so its identity is stable. */
export const NO_IMAGE_DIMENSIONS: ImageDimensionsSource = {
  getImageDimensions: () => null,
  reportImageDimensions: () => {},
}

function inlineRefQuery(ref: NonNullable<EmbeddedFileRef>): string {
  return 'key' in ref
    ? `key=${encodeURIComponent(ref.key)}`
    : `fileId=${encodeURIComponent(ref.fileId)}`
}

/**
 * Display URL for an embedded image reference.
 *
 * Workspace embeds resolve through the workspace inline route, which refuses a
 * reference from another workspace; share embeds cascade through the token's
 * inline route, which serves an image only when the shared document references
 * it. Anything that is not a workspace reference (external, `data:`, a public
 * asset) passes through untouched.
 */
export function fileImageSrc(
  source: ResourceSource<'file'>,
  src: string | undefined
): string | undefined {
  if (!src) return src
  const ref = extractEmbeddedFileRef(src)
  if (!ref) return src
  const base =
    source.via === 'share'
      ? `${shareBase(source)}/inline`
      : `/api/workspaces/${encodeURIComponent(source.workspaceId)}/files/inline`
  return `${base}?${inlineRefQuery(ref)}`
}

/**
 * The record for a shared file, built from the seed the share page already
 * resolved and authorized. There is no public "read the workspace's files"
 * endpoint to fetch it from, and adding one would hand a share token the whole
 * file list.
 *
 * `key` folds in the content version so the content caches (keyed on the storage
 * key) refetch when the shared file changes, and carries the grant so two file
 * grants under one token never collide.
 */
export function shareFileRecord(source: ShareSource<'file'>): FileViewRecord {
  const { name, type, size, version } = source.seed
  return {
    id: source.grantId,
    name,
    type,
    key: `${source.grantId}@${version}`,
    size,
    updatedAt: new Date(version),
    folderId: null,
  }
}
