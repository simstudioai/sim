'use client'

import { memo, useState } from 'react'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import { PREVIEW_LOADING_OVERLAY, UnsupportedPreview } from './preview-shared'
import { ZoomablePreview } from './zoomable-preview'

export const ImagePreview = memo(function ImagePreview({ file }: { file: WorkspaceFileRecord }) {
  const source = useFileContentSource()
  // Version the URL on updatedAt: overwrites keep the same storage key, so an unversioned
  // URL would resolve to a previously cached copy instead of the rewritten bytes.
  // `preview` lets the server substitute a renderable derivative for a HEIC.
  const serveUrl = source.buildUrl(file.key, {
    version: Number(new Date(file.updatedAt)) || file.size,
    preview: true,
  })

  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [loadedUrl, setLoadedUrl] = useState(serveUrl)

  // The parent keys this on `file.key`, which an overwrite preserves — only the
  // version changes. Without this the outcome of the previous bytes would stick,
  // leaving a replaced image permanently on the unsupported state.
  if (loadedUrl !== serveUrl) {
    setLoadedUrl(serveUrl)
    setStatus('loading')
  }

  // Covers every way the bytes can turn out unrenderable — a derivative the server
  // declined to build (too large, undecodable) and a corrupt or truncated image
  // alike — rather than leaving a broken image in the viewer.
  if (status === 'error') return <UnsupportedPreview file={file} />

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      <ZoomablePreview className='flex flex-1' contentClassName='h-full w-full'>
        <img
          src={serveUrl}
          alt={file.name}
          className='max-h-full max-w-full select-none rounded-md object-contain'
          draggable={false}
          loading='eager'
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      </ZoomablePreview>
      {status === 'loading' && PREVIEW_LOADING_OVERLAY}
    </div>
  )
})
