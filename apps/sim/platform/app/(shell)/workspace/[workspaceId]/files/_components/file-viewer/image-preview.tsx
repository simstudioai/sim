'use client'

import { useState } from 'react'
import { UnsupportedPreview } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/preview-shared'
import { ZoomablePreview } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/zoomable-preview'
import { useFileContentSource, type WorkspaceFileRecord } from '@/platform/lib/data/files'

interface ImagePreviewProps {
  file: WorkspaceFileRecord
  onDownload?: () => void
}

/**
 * An image at 25–400% zoom. `preview` lets the server substitute a renderable JPEG for a HEIC; a
 * derivative it declined, or corrupt bytes, fall back to the download offer. A content write mints
 * a new storage key, and the viewer keys this by it, so a replaced image starts over.
 */
export function ImagePreview({ file, onDownload }: ImagePreviewProps) {
  const source = useFileContentSource()
  const [failed, setFailed] = useState(false)
  const serveUrl = source.buildUrl(file.key, {
    version: Number(new Date(file.updatedAt)) || file.size,
    preview: true,
  })
  if (failed) return <UnsupportedPreview name={file.name} onDownload={onDownload} />
  return (
    <ZoomablePreview>
      <img
        src={serveUrl}
        alt={file.name}
        draggable={false}
        loading='eager'
        onError={() => setFailed(true)}
      />
    </ZoomablePreview>
  )
}
