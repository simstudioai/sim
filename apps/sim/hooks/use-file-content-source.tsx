'use client'

import { createContext, useContext } from 'react'
import {
  type EmbeddedFileRef,
  extractEmbeddedFileRef,
} from '@/lib/uploads/utils/embedded-image-ref'

export interface FileContentUrlOptions {
  /** Request the uncompiled source instead of the rendered/compiled bytes. */
  raw?: boolean
  /** Content version (e.g. the record's `updatedAt`) — makes the URL cacheable/immutable. */
  version?: string | number
  /** Append a timestamp cache-buster when there is no `version`. */
  bust?: boolean
}

function inlineRefQuery(ref: NonNullable<EmbeddedFileRef>): string {
  return 'key' in ref
    ? `key=${encodeURIComponent(ref.key)}`
    : `fileId=${encodeURIComponent(ref.fileId)}`
}

/**
 * Seam for "where do a file's bytes come from". The in-app viewer resolves the
 * auth-gated workspace serve URL; the public share page swaps in a token-scoped
 * URL. Renderers and the binary/text query hooks build their fetch URL through
 * this source so the same components work in both contexts.
 */
export interface FileContentSource {
  buildUrl: (key: string, opts?: FileContentUrlOptions) => string
  /**
   * Map an embedded image `src` to a display URL scoped to the current context: the in-app source
   * points at the workspace-scoped inline route, the public source at the token-scoped cascade route.
   * Non-workspace srcs (external, `data:`, public assets) pass through unchanged.
   */
  resolveImageSrc: (src: string | undefined) => string | undefined
}

function buildServeUrl(key: string, opts?: FileContentUrlOptions): string {
  const base = `/api/files/serve/${encodeURIComponent(key)}?context=workspace`
  const params: string[] = []
  if (opts?.version != null) params.push(`v=${encodeURIComponent(String(opts.version))}`)
  else if (opts?.bust) params.push(`t=${Date.now()}`)
  if (opts?.raw) params.push('raw=1')
  return params.length > 0 ? `${base}&${params.join('&')}` : base
}

/** Build a source whose embeds resolve through `inlineBase` (the workspace- or token-scoped inline route). */
function inlineImageSource(
  buildUrl: FileContentSource['buildUrl'],
  inlineBase: string
): FileContentSource {
  return {
    buildUrl,
    resolveImageSrc: (src) => {
      if (!src) return src
      const ref = extractEmbeddedFileRef(src)
      return ref ? `${inlineBase}?${inlineRefQuery(ref)}` : src
    },
  }
}

/**
 * In-app source scoped to one workspace. Direct file bytes come from the workspace serve URL; embedded
 * images route through `/api/workspaces/{workspaceId}/files/inline`, which resolves a reference only
 * within this workspace — a cross-workspace embed 404s and does not render.
 */
export function createWorkspaceFileContentSource(workspaceId: string): FileContentSource {
  return inlineImageSource(buildServeUrl, `/api/workspaces/${workspaceId}/files/inline`)
}

/**
 * Public share source. Direct file bytes come from the token content URL; embedded images route through
 * `/api/files/public/{token}/inline`, which serves them only when referenced by the shared document and
 * in its workspace.
 */
export function createPublicFileContentSource(
  token: string,
  contentUrl: string
): FileContentSource {
  return inlineImageSource(() => contentUrl, `/api/files/public/${token}/inline`)
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
