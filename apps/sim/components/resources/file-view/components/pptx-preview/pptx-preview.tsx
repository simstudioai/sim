'use client'

import { memo, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { PptxSandboxHost } from '@/components/resources/file-view/components/pptx-sandbox-host'
import {
  PREVIEW_LOADING_OVERLAY,
  PreviewError,
  PreviewLoadingFrame,
  resolvePreviewError,
} from '@/components/resources/file-view/components/preview-shared'
import { useDocPreviewBinary } from '@/components/resources/file-view/hooks/use-doc-preview-binary'
import type { FileViewRecord } from '@/resources/file-source'

const logger = createLogger('PptxPreview')

function pptxCacheKey(fileId: string, dataUpdatedAt: number, byteLength: number): string {
  return `${fileId}:${dataUpdatedAt}:${byteLength}`
}

export const PptxPreview = memo(function PptxPreview({ file }: { file: FileViewRecord }) {
  const preview = useDocPreviewBinary(file)
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

  if (error) return <PreviewError label='presentation' error={error} />

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
