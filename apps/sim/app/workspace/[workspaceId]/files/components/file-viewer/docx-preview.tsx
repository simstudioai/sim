'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useWorkspaceFileBinary } from '@/hooks/queries/workspace-files'
import {
  PDF_PAGE_SKELETON,
  PreviewError,
  resolvePreviewError,
  shouldSuppressStreamingDocumentError,
} from './preview-shared'

const logger = createLogger('DocxPreview')

export const DocxPreview = memo(function DocxPreview({
  file,
  workspaceId,
  streamingContent,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
  streamingContent?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lastSuccessfulHtmlRef = useRef('')
  const {
    data: fileData,
    isLoading,
    error: fetchError,
  } = useWorkspaceFileBinary(workspaceId, file.id, file.key)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [hasRenderedPreview, setHasRenderedPreview] = useState(false)

  useEffect(() => {
    if (!containerRef.current || !fileData || streamingContent !== undefined) return

    let cancelled = false

    async function render() {
      try {
        setRendering(true)
        const { renderAsync } = await import('docx-preview')
        if (cancelled || !containerRef.current) return
        setRenderError(null)
        containerRef.current.innerHTML = ''
        await renderAsync(fileData, containerRef.current, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        })
        if (!cancelled && containerRef.current) {
          const wrapper = containerRef.current.querySelector<HTMLElement>('.docx-wrapper')
          if (wrapper) wrapper.style.background = 'transparent'
          containerRef.current.querySelectorAll<HTMLElement>('section.docx').forEach((page) => {
            page.style.boxShadow = 'var(--shadow-medium)'
          })
          lastSuccessfulHtmlRef.current = containerRef.current.innerHTML
          setHasRenderedPreview(true)
        }
      } catch (err) {
        if (!cancelled) {
          const msg = toError(err).message || 'Failed to render document'
          logger.error('DOCX render failed', { error: msg })
          setRenderError(msg)
        }
      } finally {
        if (!cancelled) {
          setRendering(false)
        }
      }
    }

    render()
    return () => {
      cancelled = true
    }
  }, [fileData, streamingContent])

  useEffect(() => {
    if (streamingContent === undefined || !containerRef.current) return

    let cancelled = false
    const controller = new AbortController()

    const debounceTimer = setTimeout(async () => {
      const container = containerRef.current
      if (!container || cancelled) return

      const previousHtml = lastSuccessfulHtmlRef.current

      try {
        setRendering(true)
        setRenderError(null)

        const response = await fetch(`/api/workspaces/${workspaceId}/docx/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: streamingContent }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Preview failed' }))
          throw new Error(err.error || 'Preview failed')
        }

        const arrayBuffer = await response.arrayBuffer()
        if (cancelled || !containerRef.current) return

        const { renderAsync } = await import('docx-preview')
        if (cancelled || !containerRef.current) return

        containerRef.current.innerHTML = ''
        await renderAsync(new Uint8Array(arrayBuffer), containerRef.current, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        })

        if (!cancelled && containerRef.current) {
          const wrapper = containerRef.current.querySelector<HTMLElement>('.docx-wrapper')
          if (wrapper) wrapper.style.background = 'transparent'
          containerRef.current.querySelectorAll<HTMLElement>('section.docx').forEach((page) => {
            page.style.boxShadow = 'var(--shadow-medium)'
          })
          lastSuccessfulHtmlRef.current = containerRef.current.innerHTML
          setHasRenderedPreview(true)
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          if (containerRef.current && previousHtml) {
            containerRef.current.innerHTML = previousHtml
            setHasRenderedPreview(true)
          }
          const msg = toError(err).message || 'Failed to render document'
          if (previousHtml || shouldSuppressStreamingDocumentError(msg)) {
            logger.info('Suppressing transient DOCX streaming preview error', { error: msg })
          } else {
            logger.error('DOCX render failed', { error: msg })
            setRenderError(msg)
          }
        }
      } finally {
        if (!cancelled) {
          setRendering(false)
        }
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(debounceTimer)
      controller.abort()
    }
  }, [streamingContent, workspaceId])

  const error =
    hasRenderedPreview && streamingContent !== undefined
      ? null
      : streamingContent !== undefined
        ? renderError
        : resolvePreviewError(fetchError, renderError)
  if (error) return <PreviewError label='document' error={error} />

  const showSkeleton =
    !hasRenderedPreview &&
    ((streamingContent !== undefined && rendering) || (streamingContent === undefined && isLoading))

  return (
    <div className='relative h-full w-full overflow-auto bg-[var(--surface-1)]'>
      {showSkeleton && (
        <div className='absolute inset-0 z-10 bg-[var(--surface-1)]'>{PDF_PAGE_SKELETON}</div>
      )}
      <div
        ref={containerRef}
        className={cn('h-full w-full overflow-auto', showSkeleton && 'opacity-0')}
      />
    </div>
  )
})
