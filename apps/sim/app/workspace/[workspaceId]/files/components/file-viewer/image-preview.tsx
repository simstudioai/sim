'use client'

import { memo, useState } from 'react'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import { PREVIEW_LOADING_OVERLAY, UnsupportedPreview } from './preview-shared'
import { ZoomablePreview } from './zoomable-preview'

export const ImagePreview = memo(function ImagePreview({ file }: { file: WorkspaceFileRecord }) {
  const source = useFileContentSource()
  /** `v` busts the browser cache across content writes; `preview` lets the server
   *  substitute a renderable JPEG for a HEIC. */
  const serveUrl = source.buildUrl(file.key, {
    version: Number(new Date(file.updatedAt)) || file.size,
    preview: true,
  })

  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')

  /** A derivative the server declined to build, or corrupt bytes — show the download
   *  fallback rather than a broken image. Content writes mint a new storage key, so
   *  the parent's `key={file.key}` resets this. */
  if (status === 'error') return <UnsupportedPreview name={file.name} />

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
