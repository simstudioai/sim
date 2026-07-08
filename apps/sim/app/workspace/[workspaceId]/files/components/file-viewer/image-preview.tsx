'use client'

import { memo } from 'react'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useFileContentSource } from '@/hooks/use-file-content-source'
import { ZoomablePreview } from './zoomable-preview'

export const ImagePreview = memo(function ImagePreview({ file }: { file: WorkspaceFileRecord }) {
  const source = useFileContentSource()
  // Version the URL on updatedAt: overwrites keep the same storage key, so an unversioned
  // URL would resolve to a previously cached copy instead of the rewritten bytes.
  const serveUrl = source.buildUrl(file.key, {
    version: Number(new Date(file.updatedAt)) || file.size,
  })

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
