'use client'

import '@/platform/lib/data/files/pdf-polyfills'
import 'react-pdf/dist/Page/TextLayer.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { pdfjs, Document as ReactPdfDocument, Page as ReactPdfPage } from 'react-pdf'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/pdf-viewer.module.css'
import { PreviewError } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/preview-shared'
import { PreviewToolbar } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/preview-toolbar'
import { bindWheelZoom } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/preview-wheel'

/** The worker runs where the page's polyfills cannot reach, so it is the self-polyfilling build. */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).href

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_DEFAULT = 1
const ZOOM_STEP = 1.25
const ZOOM_WHEEL_SENSITIVITY = 0.005
/** Matches the scroller's inline padding (`--spacing-24`), which sits outside the zoomed pages. */
const VIEWER_PADDING = 24
const RESIZE_DEBOUNCE_MS = 150
const PAGE_SCROLL_MARGIN = 16

interface PdfViewerProps {
  buffer: ArrayBuffer
  filename: string
}

/**
 * Pages fit the panel's width at 100%; zoom (50–300%, buttons or Ctrl/Cmd+wheel) scales them around
 * the pointer, and the toolbar steps through pages. Text is selectable through pdf.js's text layer.
 */
export function PdfViewer({ buffer, filename }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const paddingRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const pageWidthRef = useRef<number | undefined>(undefined)
  const zoomRef = useRef(ZOOM_DEFAULT)

  const [containerWidth, setContainerWidth] = useState(0)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(ZOOM_DEFAULT)
  const [currentPage, setCurrentPage] = useState(1)
  const [loadError, setLoadError] = useState<string | null>(null)

  /** pdf.js transfers, and detaches, the buffer it receives, so it gets its own copy. */
  const file = useMemo(() => ({ data: new Uint8Array(buffer.slice(0)) }), [buffer])

  /**
   * The first measurement applies at once; later ones (a resizing pane) are debounced, since each
   * width change re-rasterises every page.
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let measured = false
    let debounce: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect
      if (!measured) {
        if (width <= 0) return
        measured = true
        setContainerWidth(width)
        return
      }
      clearTimeout(debounce)
      debounce = setTimeout(() => setContainerWidth(width), RESIZE_DEBOUNCE_MS)
    })
    observer.observe(container)
    return () => {
      clearTimeout(debounce)
      observer.disconnect()
    }
  }, [])

  const pageWidth = containerWidth > 0 ? containerWidth - 2 * VIEWER_PADDING : undefined
  pageWidthRef.current = pageWidth

  /** Geometry that follows zoom is set on the elements, as the wheel moves it every frame. */
  const applyGeometry = useCallback((nextZoom: number) => {
    const width = pageWidthRef.current
    const pages = pagesRef.current
    const padding = paddingRef.current
    if (pages) {
      pages.style.zoom = String(nextZoom)
      pages.style.width = width === undefined ? '' : `${width}px`
    }
    if (padding)
      padding.style.minWidth =
        width === undefined ? '' : `${width * nextZoom + 2 * VIEWER_PADDING}px`
  }, [])

  useLayoutEffect(() => {
    applyGeometry(zoomRef.current)
  }, [applyGeometry, pageWidth, pageCount])

  const applyZoomAt = useCallback(
    (next: number, anchorX: number, anchorY: number) => {
      const container = containerRef.current
      if (!container) return
      const ratio = next / zoomRef.current
      applyGeometry(next)
      container.scrollLeft =
        (container.scrollLeft + anchorX - VIEWER_PADDING) * ratio + VIEWER_PADDING - anchorX
      container.scrollTop =
        (container.scrollTop + anchorY - VIEWER_PADDING) * ratio + VIEWER_PADDING - anchorY
      zoomRef.current = next
      setZoom(next)
    },
    [applyGeometry]
  )

  const zoomAroundCenter = (next: number) => {
    const container = containerRef.current
    applyZoomAt(
      next,
      container ? container.clientWidth / 2 : 0,
      container ? container.clientHeight / 2 : 0
    )
  }

  const scrollToPage = (page: number) => {
    const container = containerRef.current
    if (container && zoomRef.current !== ZOOM_DEFAULT) zoomAroundCenter(ZOOM_DEFAULT)
    const wrapper = pageRefs.current[page - 1]
    if (wrapper && container)
      container.scrollTo({ top: wrapper.offsetTop - PAGE_SCROLL_MARGIN, behavior: 'smooth' })
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container || pageCount === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const page = Number((entry.target as HTMLElement).dataset.page)
          if (page) setCurrentPage(page)
        }
      },
      { root: container, threshold: 0.5 }
    )
    for (const wrapper of pageRefs.current) if (wrapper) observer.observe(wrapper)
    return () => observer.disconnect()
  }, [pageCount])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    return bindWheelZoom(container, (event) => {
      const next = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, zoomRef.current * (1 - event.deltaY * ZOOM_WHEEL_SENSITIVITY))
      )
      const rect = container.getBoundingClientRect()
      applyZoomAt(next, event.clientX - rect.left, event.clientY - rect.top)
    })
  }, [applyZoomAt])

  if (loadError) return <PreviewError label='PDF' error={loadError} />

  return (
    <div className={styles.frame}>
      {pageCount > 0 && (
        <PreviewToolbar
          navigation={{
            current: currentPage,
            total: pageCount,
            label: 'page',
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
            label: `${Math.round(zoom * 100)}%`,
            canZoomOut: zoom > ZOOM_MIN,
            canZoomIn: zoom < ZOOM_MAX,
            onReset: () => zoomAroundCenter(ZOOM_DEFAULT),
            onZoomOut: () => zoomAroundCenter(Math.max(ZOOM_MIN, zoomRef.current / ZOOM_STEP)),
            onZoomIn: () => zoomAroundCenter(Math.min(ZOOM_MAX, zoomRef.current * ZOOM_STEP)),
          }}
        />
      )}
      <div ref={containerRef} className={styles.scroller}>
        <ReactPdfDocument
          file={file}
          loading={null}
          error={null}
          onLoadSuccess={({ numPages }) => {
            setPageCount(numPages)
            setCurrentPage(1)
            setLoadError(null)
          }}
          onLoadError={(error) => setLoadError(error.message || 'Failed to load PDF')}
        >
          <div ref={paddingRef} className={styles.padding}>
            <div ref={pagesRef} className={styles.pages}>
              {Array.from({ length: pageCount }, (_, index) => (
                <div
                  key={index}
                  ref={(element) => {
                    pageRefs.current[index] = element
                  }}
                  data-page={index + 1}
                  data-elevation='control'
                  className={styles.page}
                >
                  <ReactPdfPage
                    pageNumber={index + 1}
                    width={pageWidth}
                    loading={null}
                    renderTextLayer
                    renderAnnotationLayer={false}
                    aria-label={`${filename} page ${index + 1}`}
                  />
                </div>
              ))}
            </div>
          </div>
        </ReactPdfDocument>
      </div>
    </div>
  )
}
