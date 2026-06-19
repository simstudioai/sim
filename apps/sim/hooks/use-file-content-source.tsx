'use client'

import { createContext, useContext } from 'react'

export interface FileContentUrlOptions {
  /** Request the uncompiled source instead of the rendered/compiled bytes. */
  raw?: boolean
  /** Content version (e.g. the record's `updatedAt`) — makes the URL cacheable/immutable. */
  version?: string | number
  /** Append a timestamp cache-buster when there is no `version`. */
  bust?: boolean
}

/**
 * Seam for "where do a file's bytes come from". The in-app viewer resolves the
 * auth-gated workspace serve URL; the public share page swaps in a token-scoped
 * URL. Renderers and the binary/text query hooks build their fetch URL through
 * this source so the same components work in both contexts.
 */
export interface FileContentSource {
  buildUrl: (key: string, opts?: FileContentUrlOptions) => string
}

/** Default source: the auth-gated workspace serve URL (the historical behavior). */
export const workspaceFileContentSource: FileContentSource = {
  buildUrl: (key, opts) => {
    const base = `/api/files/serve/${encodeURIComponent(key)}?context=workspace`
    const params: string[] = []
    if (opts?.version != null) params.push(`v=${encodeURIComponent(String(opts.version))}`)
    else if (opts?.bust) params.push(`t=${Date.now()}`)
    if (opts?.raw) params.push('raw=1')
    return params.length > 0 ? `${base}&${params.join('&')}` : base
  },
}

const FileContentSourceContext = createContext<FileContentSource>(workspaceFileContentSource)

export const FileContentSourceProvider = FileContentSourceContext.Provider

export function useFileContentSource(): FileContentSource {
  return useContext(FileContentSourceContext)
}
