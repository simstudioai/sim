'use client'

import { createLogger } from '@/lib/logs/console/logger'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

const logger = createLogger('FileViewer')

interface FileViewerProps {
  file: WorkspaceFileRecord
}

export function FileViewer({ file }: FileViewerProps) {
  const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`

  return (
    <div className='fixed inset-0 z-50 bg-white'>
      <iframe
        src={serveUrl}
        className='h-full w-full border-0'
        title={file.name}
        onError={(e) => {
          logger.error(`Failed to load file: ${file.name}`)
        }}
      />
    </div>
  )
}
