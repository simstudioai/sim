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
}

export interface FileContentUrlOptions {
  /** Request the uncompiled source instead of the rendered/compiled bytes. */
  raw?: boolean
  /** Content version (e.g. the record's `updatedAt`) — makes the URL cacheable/immutable. */
  version?: string | number
  /** Append a timestamp cache-buster when there is no `version`. */
  bust?: boolean
}

/**
 * Route prefix a share token addresses a file through.
 *
 * A file share exposes exactly one file and grants it under the token itself; an
 * interface exposes a file per module and grants it under the module id. The two
 * route families are otherwise identical (`/content`, `/inline`), so the grant
 * tells them apart without a second axis.
 */
function shareBase(source: ShareSource<'file'>): string {
  const token = encodeURIComponent(source.token)
  return source.grantId === source.token
    ? `/api/files/public/${token}`
    : `/api/interfaces/public/${token}/modules/${encodeURIComponent(source.grantId)}/file`
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
  if (source.via === 'share') return `${shareBase(source)}/content`

  const base = `/api/files/serve/${encodeURIComponent(key)}?context=workspace`
  const params: string[] = []
  if (options?.version != null) params.push(`v=${encodeURIComponent(String(options.version))}`)
  else if (options?.bust) params.push(`t=${Date.now()}`)
  if (options?.raw) params.push('raw=1')
  return params.length > 0 ? `${base}&${params.join('&')}` : base
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
