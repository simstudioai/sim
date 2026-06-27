'use client'

import { memo, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { PptxSandboxHost } from '@/app/workspace/[workspaceId]/files/components/file-viewer/pptx-sandbox-host'
import {
  PREVIEW_LOADING_OVERLAY,
  PreviewError,
  PreviewLoadingFrame,
  resolvePreviewError,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-shared'
import { useDocPreviewBinary } from '@/app/workspace/[workspaceId]/files/components/file-viewer/use-doc-preview-binary'
import { useTranslations } from 'next-intl'

const logger = createLogger('PptxPreview')

function pptxCacheKey(fileId: string, dataUpdatedAt: number, byteLength: number): string {
  return `${fileId}:${dataUpdatedAt}:${byteLength}`
}

export const PptxPreview = memo(function PptxPreview({
  file,
  workspaceId,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
}) {
  const t = useTranslations('auto')
  const preview = useDocPreviewBinary(workspaceId, file)
  const fileData = preview.data
  const cacheKey = pptxCacheKey(file.id, preview.dataUpdatedAt, fileData?.byteLength ?? 0)

  const [hasRendered, setHasRendered] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    setRenderError(null)
    setHasRendered(false)
  }, [cacheKey])

  function handleRenderStart() {
    setRenderError(null)
  }

  function handleRenderComplete() {
    setHasRendered(true)
  }

  function handleRenderError(message: string) {
    logger.error('PPTX render failed', { error: message })
    setRenderError(message || 'Failed to render presentation')
  }

  const error = resolvePreviewError(preview.error, renderError)

  if (error) return <PreviewError label={t('presentation')} error={error} />

  if (!fileData) {
    return <PreviewLoadingFrame className='h-full flex-1' tone='surface' />
  }

  return (
    <div className='relative flex h-full min-h-0 flex-1 overflow-hidden bg-[var(--surface-1)]'>
      <PptxSandboxHost
        buffer={fileData}
        requestId={cacheKey}
        onRenderStart={handleRenderStart}
        onRenderComplete={handleRenderComplete}
        onRenderError={handleRenderError}
      />
      {!hasRendered && PREVIEW_LOADING_OVERLAY}
    </div>
  )
})
