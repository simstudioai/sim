'use client'

import dynamic from 'next/dynamic'
import {
  PreviewError,
  PreviewErrorBoundary,
  resolvePreviewError,
} from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/preview-shared'
import { useDocPreviewBinary, type WorkspaceFileRecord } from '@/platform/lib/data/files'

const PdfViewer = dynamic(
  () =>
    import('@/app/(product)/workspace/[workspaceId]/_components/file-viewer/pdf-viewer').then(
      (module) => module.PdfViewer
    ),
  { ssr: false }
)

interface PdfPreviewProps {
  file: WorkspaceFileRecord
  workspaceId: string
}

/** A PDF, uploaded or generated: its bytes are read once ready and drawn page by page. */
export function PdfPreview({ file, workspaceId }: PdfPreviewProps) {
  const preview = useDocPreviewBinary(workspaceId, file)
  const error = resolvePreviewError(preview.error, null)
  if (error) return <PreviewError label='PDF' error={error} />
  if (!preview.data) return null
  return (
    <PreviewErrorBoundary key={`${file.id}:${preview.dataUpdatedAt}`} label='PDF'>
      <PdfViewer buffer={preview.data} filename={file.name} />
    </PreviewErrorBoundary>
  )
}
