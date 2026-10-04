'use client'

import { createContext, useContext } from 'react'
import {
  type EmbeddedFileRef,
  resolveEmbeddedFileRef,
  storedFileId,
} from '@/lib/uploads/utils/embedded-image-ref'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { EditableFileOwner, FileOwner } from '@/lib/workspace-files/ownership'

export interface FileContentUrlOptions {
  /** Request the uncompiled source instead of the rendered/compiled bytes. */
  raw?: boolean
  /**
   * Declare the bytes are being rendered, not downloaded, so the server may substitute a
   * browser-renderable derivative for a format no browser decodes (HEIC). Downloads must
   * leave this off — they need the stored bytes.
   */
  preview?: boolean
  /** Content version (e.g. the record's `updatedAt`) — makes the URL cacheable/immutable. */
  version?: string | number
  /** Append a timestamp cache-buster when there is no `version`. */
  bust?: boolean
}

function inlineRefQuery(ref: NonNullable<EmbeddedFileRef>): string {
  return 'key' in ref
    ? `key=${encodeURIComponent(ref.key)}`
    : `fileId=${encodeURIComponent(storedFileId(ref.fileId))}`
}

export interface ImageDimensions {
  width: number
  height: number
}

/**
 * Optional per-context capability: reserve layout space for an embedded image from its intrinsic size,
 * so it never reflows on load. The workspace source backs this with file-list metadata plus a self-
 * correcting metadata write; public/embedded sources omit it and fall back to on-load measurement (one
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

/**
 * Seam for "where do a file's bytes come from". The in-app viewer resolves the
 * auth-gated workspace serve URL; the public share page swaps in a token-scoped
 * URL. Renderers and the binary/text query hooks build their fetch URL through
 * this source so the same components work in both contexts.
 */
export interface FileContentSource {
  owner?: EditableFileOwner
  buildUrl: (key: string, opts?: FileContentUrlOptions) => string
  /**
   * Map an embedded image `src` to a display URL scoped to the current context: the in-app source
   * points at the workspace-scoped inline route, the public source at the token-scoped cascade route.
   * Non-workspace srcs (external, `data:`, public assets) pass through unchanged.
   */
  resolveImageSrc: (src: string | undefined) => string | undefined
  /** Present only where intrinsic image dimensions are resolvable (the workspace viewer). */
  getImageDimensions?: ImageDimensionsSource['getImageDimensions']
  reportImageDimensions?: ImageDimensionsSource['reportImageDimensions']
}

function buildServeUrl(
  key: string,
  opts?: FileContentUrlOptions,
  storageContext: 'workspace' | 'mothership' = 'workspace'
): string {
  const base = `/api/files/serve/${encodeURIComponent(key)}?context=${storageContext}`
  const params: string[] = []
  if (opts?.version != null) params.push(`v=${encodeURIComponent(String(opts.version))}`)
  else if (opts?.bust) params.push(`t=${Date.now()}`)
  if (opts?.raw) params.push('raw=1')
  if (opts?.preview) params.push('preview=1')
  return params.length > 0 ? `${base}&${params.join('&')}` : base
}

/** Build a source whose embeds resolve through `inlineBase` (the workspace- or token-scoped inline route). */
function inlineImageSource(
  buildUrl: FileContentSource['buildUrl'],
  inlineBase: string,
  owner?: EditableFileOwner
): FileContentSource {
  return {
    buildUrl,
    resolveImageSrc: (src) => {
      if (!src) return src
      const resolved = resolveEmbeddedFileRef(
        src,
        owner,
        typeof window === 'undefined' ? undefined : window.location.origin
      )
      if (resolved.kind === 'rejected') return undefined
      return resolved.kind === 'file' ? `${inlineBase}?${inlineRefQuery(resolved.reference)}` : src
    },
  }
}

/**
 * In-app source scoped to one workspace. Direct file bytes come from the workspace serve URL; embedded
 * images route through `/api/workspaces/{workspaceId}/files/inline`, which resolves a reference only
 * within this workspace — a cross-workspace embed 404s and does not render.
 */
export function createWorkspaceFileContentSource(
  workspaceId: string,
  imageDimensions?: ImageDimensionsSource,
  storageContext: 'workspace' | 'mothership' = 'workspace'
): FileContentSource {
  return {
    owner: { entityType: 'workspace', entityId: workspaceId },
    ...inlineImageSource(
      (key, opts) => buildServeUrl(key, opts, storageContext),
      `/api/workspaces/${workspaceId}/files/inline`,
      { entityType: 'workspace', entityId: workspaceId }
    ),
    ...imageDimensions,
  }
}

/** Authenticated Project bytes and embeds retain their explicit owner independently of navigation. */
function createProjectFileContentSource(projectId: string, fileId: string): FileContentSource {
  const base = `/api/projects/${encodeURIComponent(projectId)}/files`
  return {
    owner: { entityType: 'project', entityId: projectId },
    ...inlineImageSource(
      (_key, opts) => `${base}/${encodeURIComponent(fileId)}/${opts?.raw ? 'content' : 'artifact'}`,
      `${base}/inline`,
      { entityType: 'project', entityId: projectId }
    ),
  }
}

interface OwnedContentSourceOptions {
  imageDimensions?: ImageDimensionsSource
  storageContext?: 'workspace' | 'mothership'
}

type ContentSourceAdapter = (
  ownerId: string,
  fileId: string,
  options?: OwnedContentSourceOptions
) => FileContentSource

const FILE_CONTENT_ADAPTERS: FileOwnerAdapters<ContentSourceAdapter> = {
  workspace: (id, _fileId, options) =>
    createWorkspaceFileContentSource(id, options?.imageDimensions, options?.storageContext),
  project: (id, fileId) => createProjectFileContentSource(id, fileId),
}

/** Authenticated owner dispatch is separate from bearer-token sources. */
export function createOwnedFileContentSource(
  owner: FileOwner,
  fileId: string,
  options?: OwnedContentSourceOptions
): FileContentSource {
  return requireFileOwnerAdapter(FILE_CONTENT_ADAPTERS, owner)(owner.entityId, fileId, options)
}

/**
 * Public share source. Direct file bytes come from the token content URL; embedded images route through
 * `/api/files/public/{token}/inline`, which serves them only when referenced by the shared document and
 * in its canonical owner.
 */
export function createPublicFileContentSource(
  token: string,
  contentUrl: string,
  owner?: EditableFileOwner
): FileContentSource {
  return inlineImageSource(
    (_key, opts) =>
      opts?.preview ? `${contentUrl}${contentUrl.includes('?') ? '&' : '?'}preview=1` : contentUrl,
    `/api/files/public/${token}/inline`,
    owner
  )
}

/**
 * Context default for components rendered outside a {@link FileContentSourceProvider}: serve URLs for
 * direct bytes, embeds passed through unchanged. The file viewer always provides a workspace- or
 * token-scoped source, so embeds resolve through the scoped inline routes there.
 */
export const workspaceFileContentSource: FileContentSource = {
  buildUrl: buildServeUrl,
  resolveImageSrc: (src) => src,
}

const FileContentSourceContext = createContext<FileContentSource>(workspaceFileContentSource)

export const FileContentSourceProvider = FileContentSourceContext.Provider

export function useFileContentSource(): FileContentSource {
  return useContext(FileContentSourceContext)
}
