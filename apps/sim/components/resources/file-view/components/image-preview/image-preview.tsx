'use client'

import { memo, useState } from 'react'
import { PREVIEW_LOADING_OVERLAY } from '@/components/resources/file-view/components/preview-shared/preview-shared'
import { ZoomablePreview } from '@/components/resources/file-view/components/zoomable-preview/zoomable-preview'
import { useResourceOfKind } from '@/components/resources/resource-provider'
import { type FileViewRecord, fileContentUrl } from '@/resources/file-source'

export const ImagePreview = memo(function ImagePreview({ file }: { file: FileViewRecord }) {
  const { source } = useResourceOfKind('file')
  const [hasSettled, setHasSettled] = useState(false)
  // Version the URL on updatedAt: overwrites keep the same storage key, so an unversioned
  // URL would resolve to a previously cached copy instead of the rewritten bytes.
  const serveUrl = fileContentUrl(source, file.key, {
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
