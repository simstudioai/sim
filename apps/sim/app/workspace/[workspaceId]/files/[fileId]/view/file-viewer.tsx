'use client'

import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { useWorkspaceFileRecord } from '@/hooks/queries/workspace-files'

const logger = createLogger('FileViewer')

export function FileViewer() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const fileId = params?.fileId as string

  const { data: file, isLoading } = useWorkspaceFileRecord(workspaceId, fileId)

  if (isLoading || !file) {
    return null
  }

  const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`

  return (
    <div className='fixed inset-0 z-50 bg-[var(--bg)]'>
      <iframe
        src={serveUrl}
        className='h-full w-full border-0'
        title={file.name}
        onError={() => {
          logger.error(`Failed to load file: ${file.name}`)
        }}
      />
    </div>
  )
}
