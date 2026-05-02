'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useWorkspaceFileBinary } from '@/hooks/queries/workspace-files'
import { PDF_PAGE_SKELETON, PreviewError, resolvePreviewError } from './preview-shared'

const logger = createLogger('DocxPreview')

/**
 * Fit the rendered docx pages to the host container width using a CSS scale.
 * The library renders `<section class="docx">` at the document's natural page
 * width (in cm), which overflows narrow panels.
 */
function fitDocxToContainer(host: HTMLElement) {
  const wrapper = host.querySelector<HTMLElement>('.docx-wrapper')
  if (!wrapper) return
  const section = wrapper.querySelector<HTMLElement>('section.docx')
  if (!section) return

  wrapper.style.transform = ''
  wrapper.style.transformOrigin = 'top left'
  wrapper.style.width = ''
  wrapper.style.marginRight = ''
  wrapper.style.marginBottom = ''

  const naturalPageWidth = section.offsetWidth
  if (!naturalPageWidth) return

  const wrapperStyle = window.getComputedStyle(wrapper)
  const horizontalPadding =
    Number.parseFloat(wrapperStyle.paddingLeft) + Number.parseFloat(wrapperStyle.paddingRight)
  const naturalWrapperWidth = naturalPageWidth + horizontalPadding
  const available = host.clientWidth
  const scale = Math.min(1, available / naturalWrapperWidth)

  if (scale >= 1) return

  wrapper.style.width = `${naturalWrapperWidth}px`
  wrapper.style.transform = `scale(${scale})`
  const naturalHeight = wrapper.offsetHeight
  wrapper.style.marginRight = `${(scale - 1) * naturalWrapperWidth}px`
  wrapper.style.marginBottom = `${(scale - 1) * naturalHeight}px`
}

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

  const applyPostRenderStyling = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const wrapper = container.querySelector<HTMLElement>('.docx-wrapper')
    if (wrapper) wrapper.style.background = 'transparent'
    container.querySelectorAll<HTMLElement>('section.docx').forEach((page) => {
      page.style.boxShadow = 'var(--shadow-medium)'
    })
    fitDocxToContainer(container)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => fitDocxToContainer(container))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

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
          applyPostRenderStyling()
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
  }, [fileData, streamingContent, applyPostRenderStyling])

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

        // boundary-raw-fetch: route returns binary DOCX (read via response.arrayBuffer()), not JSON
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
          applyPostRenderStyling()
          lastSuccessfulHtmlRef.current = containerRef.current.innerHTML
          setHasRenderedPreview(true)
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          if (containerRef.current && previousHtml) {
            containerRef.current.innerHTML = previousHtml
            applyPostRenderStyling()
            setHasRenderedPreview(true)
          }
          const msg = toError(err).message || 'Failed to render document'
          logger.info('Transient DOCX streaming preview error (suppressed)', { error: msg })
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
  }, [streamingContent, workspaceId, applyPostRenderStyling])

  const error = streamingContent !== undefined ? null : resolvePreviewError(fetchError, renderError)
  if (error) return <PreviewError label='document' error={error} />

  const showSkeleton =
    !hasRenderedPreview && (streamingContent !== undefined || isLoading || rendering)

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
