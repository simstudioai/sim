'use client'

import { memo, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { PptxSandboxHost } from '@/app/workspace/[workspaceId]/files/components/file-viewer/pptx-sandbox-host'
import {
  PREVIEW_LOADING_OVERLAY,
  PreviewError,
  PreviewLoadingFrame,
  resolvePreviewError,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-shared'
import { useWorkspaceFileBinary } from '@/hooks/queries/workspace-files'

const logger = createLogger('PptxPreview')

function pptxCacheKey(fileId: string, dataUpdatedAt: number, byteLength: number): string {
  return `${fileId}:${dataUpdatedAt}:${byteLength}`
}

export const PptxPreview = memo(function PptxPreview({
  file,
  workspaceId,
  streamingContent,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
  streamingContent?: string
}) {
  const {
    data: fileData,
    error: fetchError,
    dataUpdatedAt,
  } = useWorkspaceFileBinary(workspaceId, file.id, file.key)

  const cacheKey = pptxCacheKey(file.id, dataUpdatedAt, fileData?.byteLength ?? 0)

  const [streamBuffer, setStreamBuffer] = useState<ArrayBuffer | null>(null)
  const [streamVersion, setStreamVersion] = useState(0)
  const [hasRendered, setHasRendered] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const isStreaming = streamingContent !== undefined

  useEffect(() => {
    if (!isStreaming) return

    let cancelled = false
    const controller = new AbortController()

    const debounceTimer = setTimeout(async () => {
      if (cancelled) return
      try {
        // boundary-raw-fetch: route returns binary PPTX (read via response.arrayBuffer()), not JSON
        const response = await fetch(`/api/workspaces/${workspaceId}/pptx/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: streamingContent }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Preview failed' }))
          throw new Error(err.error || 'Preview failed')
        }
        if (cancelled) return
        const arrayBuffer = await response.arrayBuffer()
        if (cancelled) return
        setRenderError(null)
        setStreamBuffer(arrayBuffer)
        setStreamVersion((version) => version + 1)
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          const msg = toError(err).message || 'Failed to render presentation'
          logger.info('Transient PPTX streaming preview error (suppressed)', { error: msg })
        }
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(debounceTimer)
      controller.abort()
    }
  }, [isStreaming, streamingContent, workspaceId])

  useEffect(() => {
    setRenderError(null)
    setHasRendered(false)
    if (!isStreaming) setStreamBuffer(null)
  }, [cacheKey, isStreaming])

  const activeBuffer = isStreaming ? streamBuffer : fileData
  const activeRenderKey = isStreaming
    ? `${file.id}:stream:${streamVersion}:${streamBuffer?.byteLength ?? 0}`
    : cacheKey

  function handleRenderStart() {
    if (!isStreaming) setRenderError(null)
  }

  function handleRenderComplete() {
    setHasRendered(true)
  }

  function handleRenderError(message: string) {
    if (isStreaming) {
      logger.info('Transient PPTX streaming render error (suppressed)', { error: message })
      return
    }
    logger.error('PPTX render failed', { error: message })
    setRenderError(message || 'Failed to render presentation')
  }

  const error = isStreaming ? null : resolvePreviewError(fetchError, renderError)

  if (error) return <PreviewError label='presentation' error={error} />

  if (!activeBuffer) {
    return <PreviewLoadingFrame className='h-full flex-1' tone='surface' />
  }

  return (
    <div className='relative flex h-full min-h-0 flex-1 overflow-hidden bg-[var(--surface-1)]'>
      <PptxSandboxHost
        buffer={activeBuffer}
        requestId={activeRenderKey}
        onRenderStart={handleRenderStart}
        onRenderComplete={handleRenderComplete}
        onRenderError={handleRenderError}
      />
      {!hasRendered && PREVIEW_LOADING_OVERLAY}
    </div>
  )
})
