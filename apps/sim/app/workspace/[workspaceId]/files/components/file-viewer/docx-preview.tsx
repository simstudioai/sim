'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { PREVIEW_LOADING_OVERLAY, PreviewError, resolvePreviewError } from './preview-shared'
import { PreviewToolbar } from './preview-toolbar'
import { bindPreviewWheelZoom } from './preview-wheel-zoom'
import { useDocPreviewBinary } from './use-doc-preview-binary'

const logger = createLogger('DocxPreview')

const DOCX_ZOOM_MIN = 25
const DOCX_ZOOM_MAX = 400
const DOCX_ZOOM_STEP = 20
const DOCX_ZOOM_WHEEL_SENSITIVITY = 0.005
const DOCX_RESIZE_DEBOUNCE_MS = 150

/**
 * Fit the rendered docx pages to the host container width using a CSS scale.
 * The library renders `<section class="docx">` at the document's natural page
 * width (in cm), which overflows narrow panels. 100% zoom means fit-to-width —
 * pages upscale past their natural print size in wide panels (CSS zoom of HTML
 * stays crisp), matching the PDF preview's semantics.
 */
function fitDocxToContainer(host: HTMLElement, viewport: HTMLElement, zoomPercent: number) {
  const wrapper = host.querySelector<HTMLElement>('.docx-wrapper')
  if (!wrapper) return
  const section = wrapper.querySelector<HTMLElement>('section.docx')
  if (!section) return

  host.style.minWidth = ''
  host.style.minHeight = ''
  host.style.width = ''
  host.style.display = 'flex'
  host.style.flexDirection = 'column'
  host.style.alignItems = 'center'
  wrapper.style.zoom = ''
  wrapper.style.width = ''
  wrapper.style.flex = '0 0 auto'
  wrapper.style.marginRight = ''
  wrapper.style.marginBottom = ''

  const naturalPageWidth = section.offsetWidth
  if (!naturalPageWidth) return

  const wrapperStyle = window.getComputedStyle(wrapper)
  const horizontalPadding =
    Number.parseFloat(wrapperStyle.paddingLeft) + Number.parseFloat(wrapperStyle.paddingRight)
  const naturalWrapperWidth = naturalPageWidth + horizontalPadding
  const available = viewport.clientWidth
  const fitScale = available / naturalWrapperWidth
  const scale = fitScale * (zoomPercent / 100)
  const scaledWrapperWidth = naturalWrapperWidth * scale

  wrapper.style.width = `${naturalWrapperWidth}px`
  wrapper.style.zoom = String(scale)
  host.style.width = `${Math.max(available, scaledWrapperWidth)}px`
  host.style.minWidth = `${scaledWrapperWidth}px`
  host.style.minHeight = `${wrapper.offsetHeight * scale}px`
}

export const DocxPreview = memo(function DocxPreview({
  file,
  workspaceId,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const zoomPercentRef = useRef(100)
  const preview = useDocPreviewBinary(workspaceId, file)
  const fileData = preview.data
  const [renderError, setRenderError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [hasRenderedPreview, setHasRenderedPreview] = useState(false)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [pageCount, setPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [documentRenderVersion, setDocumentRenderVersion] = useState(0)

  const applyPostRenderStyling = useCallback(() => {
    const container = containerRef.current
    const scrollContainer = scrollContainerRef.current
    if (!container || !scrollContainer) return
    const wrapper = container.querySelector<HTMLElement>('.docx-wrapper')
    if (wrapper) wrapper.style.background = 'transparent'
    const pages = Array.from(container.querySelectorAll<HTMLElement>('section.docx'))
    pages.forEach((page, index) => {
      page.style.boxShadow = 'var(--shadow-medium)'
      page.dataset.page = String(index + 1)
    })
    setPageCount((previous) => (previous === pages.length ? previous : pages.length))
    setCurrentPage((current) => (pages.length > 0 ? Math.min(current, pages.length) : 1))
    fitDocxToContainer(container, scrollContainer, zoomPercentRef.current)
  }, [])

  /**
   * Resize refits are debounced: each one re-queries the rendered pages and
   * recomputes the fit scale, so per-tick refits during a panel-divider drag
   * would thrash layout continuously (the initial fit is applied directly by
   * the render path, not this observer). Mirrors the PDF preview's debounce.
   */
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return
    let debounce: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(debounce)
      debounce = setTimeout(() => applyPostRenderStyling(), DOCX_RESIZE_DEBOUNCE_MS)
    })
    observer.observe(scrollContainer)
    return () => {
      clearTimeout(debounce)
      observer.disconnect()
    }
  }, [applyPostRenderStyling])

  const applyZoomAt = useCallback(
    (nextZoom: number, anchorX: number, anchorY: number) => {
      const scrollContainer = scrollContainerRef.current
      if (!scrollContainer) return

      const clampedZoom = Math.round(Math.min(Math.max(nextZoom, DOCX_ZOOM_MIN), DOCX_ZOOM_MAX))
      const wrapper = containerRef.current?.querySelector<HTMLElement>('.docx-wrapper')
      const containerRect = scrollContainer.getBoundingClientRect()
      const anchorClientX = containerRect.left + anchorX
      const anchorClientY = containerRect.top + anchorY
      const beforeRect = wrapper?.getBoundingClientRect()
      const anchorRatioX =
        beforeRect && beforeRect.width > 0
          ? (anchorClientX - beforeRect.left) / beforeRect.width
          : 0
      const anchorRatioY =
        beforeRect && beforeRect.height > 0
          ? (anchorClientY - beforeRect.top) / beforeRect.height
          : 0

      zoomPercentRef.current = clampedZoom
      setZoomPercent(clampedZoom)
      applyPostRenderStyling()

      const afterRect = wrapper?.getBoundingClientRect()
      if (!beforeRect || !afterRect) return

      scrollContainer.scrollLeft += afterRect.left + anchorRatioX * afterRect.width - anchorClientX
      scrollContainer.scrollTop += afterRect.top + anchorRatioY * afterRect.height - anchorClientY
    },
    [applyPostRenderStyling]
  )

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    return bindPreviewWheelZoom(scrollContainer, (event) => {
      const rect = scrollContainer.getBoundingClientRect()
      applyZoomAt(
        zoomPercentRef.current * (1 - event.deltaY * DOCX_ZOOM_WHEEL_SENSITIVITY),
        event.clientX - rect.left,
        event.clientY - rect.top
      )
    })
  }, [applyZoomAt])

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    const container = containerRef.current
    if (!scrollContainer || !container || pageCount === 0) return

    const pages = Array.from(container.querySelectorAll<HTMLElement>('section.docx'))
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const page = Number((entry.target as HTMLElement).dataset.page)
            if (page) setCurrentPage(page)
          }
        }
      },
      { root: scrollContainer, threshold: 0.5 }
    )

    for (const page of pages) {
      observer.observe(page)
    }

    return () => observer.disconnect()
  }, [pageCount, documentRenderVersion])

  useEffect(() => {
    if (!containerRef.current || !fileData) return

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
          setHasRenderedPreview(true)
          setDocumentRenderVersion((version) => version + 1)
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
  }, [fileData, applyPostRenderStyling])

  const error = resolvePreviewError(preview.error, renderError)
  if (error) return <PreviewError label='document' error={error} />

  const showLoadingFrame = !hasRenderedPreview && (!fileData || rendering)

  const scrollToPage = (page: number) => {
    const scrollContainer = scrollContainerRef.current
    const target = containerRef.current?.querySelector<HTMLElement>(
      `section.docx[data-page="${page}"]`
    )
    if (!scrollContainer || !target) return

    if (zoomPercentRef.current !== 100) {
      applyZoomAt(100, scrollContainer.clientWidth / 2, scrollContainer.clientHeight / 2)
    }

    scrollContainer.scrollTo({
      top: target.offsetTop - scrollContainer.offsetTop - 16,
      behavior: 'smooth',
    })
  }

  return (
    <div className='flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
      <PreviewToolbar
        navigation={{
          current: currentPage,
          total: pageCount,
          label: 'page',
          canPrevious: pageCount > 0 && currentPage > 1,
          canNext: pageCount > 0 && currentPage < pageCount,
          onPrevious: () => {
            const previous = Math.max(1, currentPage - 1)
            setCurrentPage(previous)
            scrollToPage(previous)
          },
          onNext: () => {
            const next = Math.min(pageCount, currentPage + 1)
            setCurrentPage(next)
            scrollToPage(next)
          },
        }}
        zoom={{
          label: `${zoomPercent}%`,
          canZoomOut: zoomPercent > DOCX_ZOOM_MIN,
          canZoomIn: zoomPercent < DOCX_ZOOM_MAX,
          onReset: () => {
            const c = scrollContainerRef.current
            applyZoomAt(100, c ? c.clientWidth / 2 : 0, c ? c.clientHeight / 2 : 0)
          },
          onZoomOut: () => {
            const c = scrollContainerRef.current
            applyZoomAt(
              zoomPercent - DOCX_ZOOM_STEP,
              c ? c.clientWidth / 2 : 0,
              c ? c.clientHeight / 2 : 0
            )
          },
          onZoomIn: () => {
            const c = scrollContainerRef.current
            applyZoomAt(
              zoomPercent + DOCX_ZOOM_STEP,
              c ? c.clientWidth / 2 : 0,
              c ? c.clientHeight / 2 : 0
            )
          },
        }}
      />
      <div
        ref={scrollContainerRef}
        className='relative min-h-0 flex-1 overflow-auto bg-[var(--surface-1)]'
      >
        {showLoadingFrame && PREVIEW_LOADING_OVERLAY}
        <div
          ref={containerRef}
          className={cn('min-h-full w-full', showLoadingFrame && 'opacity-0')}
        />
      </div>
    </div>
  )
})
