'use client'

import { memo, useState } from 'react'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import { PREVIEW_LOADING_OVERLAY } from './preview-shared'
import { ZoomablePreview } from './zoomable-preview'

export const ImagePreview = memo(function ImagePreview({ file }: { file: WorkspaceFileRecord }) {
  const source = useFileContentSource()
  const [hasSettled, setHasSettled] = useState(false)
  // Version the URL on updatedAt: overwrites keep the same storage key, so an unversioned
  // URL would resolve to a previously cached copy instead of the rewritten bytes.
  const serveUrl = source.buildUrl(file.key, {
    version: Number(new Date(file.updatedAt)) || file.size,
  })

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      <ZoomablePreview className='flex flex-1' contentClassName='h-full w-full'>
        <img
          src={serveUrl}
          alt={file.name}
          className='max-h-full max-w-full select-none rounded-md object-contain'
          draggable={false}
          loading='eager'
          onLoad={() => setHasSettled(true)}
          onError={() => setHasSettled(true)}
        />
      </ZoomablePreview>
      {!hasSettled && PREVIEW_LOADING_OVERLAY}
    </div>
  )
})
