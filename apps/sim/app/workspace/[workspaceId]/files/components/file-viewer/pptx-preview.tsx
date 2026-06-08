'use client'

import { memo, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Skeleton } from '@/components/emcn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { PptxSandboxHost } from '@/app/workspace/[workspaceId]/files/components/file-viewer/pptx-sandbox-host'
import {
  PreviewError,
  resolvePreviewError,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-shared'
import { useWorkspaceFileBinary } from '@/hooks/queries/workspace-files'

const logger = createLogger('PptxPreview')

const PPTX_SLIDE_SKELETON = (
  <div className='flex flex-1 flex-col items-center gap-4 overflow-y-auto bg-[var(--surface-1)] p-6'>
    {[0, 1].map((i) => (
      <div
        key={i}
        className='w-full max-w-[720px] shrink-0 rounded-md bg-[var(--surface-2)] p-8 shadow-medium'
        style={{ aspectRatio: '16 / 9' }}
      >
        <div className='flex h-full flex-col justify-between'>
          <div className='flex flex-col gap-3'>
            <Skeleton className='h-[18px] w-[50%]' />
            <Skeleton className='h-[14px] w-[70%]' />
            <Skeleton className='h-[14px] w-[60%]' />
          </div>
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-[14px] w-[80%]' />
            <Skeleton className='h-[14px] w-[65%]' />
          </div>
        </div>
      </div>
    ))}
  </div>
)

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
  // Generated decks are 0 bytes until the tool commits the compiled source at the
  // end of the run; only fetch the compiled artifact once content exists so we
  // don't 409-poll the serve route throughout generation. Uploaded decks always
  // have size > 0, so they fetch immediately as before.
  const {
    data: fileData,
    error: fetchError,
    dataUpdatedAt,
  } = useWorkspaceFileBinary(workspaceId, file.id, file.key, {
    enabled: (file.size ?? 0) > 0,
    // edit_content updates in place (same storage key); version on updatedAt so an
    // open preview refetches the new binary instead of showing the stale one.
    version: Number(new Date(file.updatedAt)) || file.size,
  })

  const cacheKey = pptxCacheKey(file.id, dataUpdatedAt, fileData?.byteLength ?? 0)

  const [hasRendered, setHasRendered] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  // The deck is compiled to a committed binary (E2B doc sandbox, or isolated-vm
  // when disabled) and served by useWorkspaceFileBinary. There is no live per-tick
  // preview: while the agent is still generating (isStreaming), we show the
  // loading skeleton and render the committed artifact once it lands/updates.
  const isStreaming = streamingContent !== undefined

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

  // Suppress transient fetch errors while generating — show the skeleton instead
  // of a "failed to preview" flash until the committed artifact is ready.
  const error = isStreaming ? null : resolvePreviewError(fetchError, renderError)

  if (error) return <PreviewError label='presentation' error={error} />

  if (!fileData) {
    return PPTX_SLIDE_SKELETON
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
      {!hasRendered && <div className='absolute inset-0'>{PPTX_SLIDE_SKELETON}</div>}
    </div>
  )
})
