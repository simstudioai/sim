'use client'

import { memo } from 'react'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { ZoomablePreview } from './zoomable-preview'

export const ImagePreview = memo(function ImagePreview({ file }: { file: WorkspaceFileRecord }) {
  const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`

  return (
    <ZoomablePreview className='flex flex-1' contentClassName='h-full w-full'>
      <img
        src={serveUrl}
        alt={file.name}
        className='max-h-full max-w-full select-none rounded-md object-contain'
        draggable={false}
        loading='eager'
      />
    </ZoomablePreview>
  )
})
