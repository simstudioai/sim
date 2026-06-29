'use client'

/**
 * Must precede the react-pdf import: pdf.js calls the polyfilled APIs while
 * its module evaluates, which throws on Safari < 17.4 without them.
 */
import '@/lib/core/utils/browser-polyfills'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { pdfjs, Document as ReactPdfDocument, Page as ReactPdfPage } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import { useTranslations } from 'next-intl'
import { PREVIEW_LOADING_OVERLAY } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-shared'
import { PreviewToolbar } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-toolbar'
import { bindPreviewWheelZoom } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-wheel-zoom'

/**
 * The worker runs in its own context that browser-polyfills cannot reach, so
 * serve the legacy worker build, which bundles its own polyfills.
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).href

const logger = createLogger('PdfViewer')

const PDF_ZOOM_MIN = 0.5
const PDF_ZOOM_MAX = 3
const PDF_ZOOM_DEFAULT = 1
const PDF_ZOOM_STEP = 1.25
const PDF_VIEWER_PADDING = 24
const PDF_RESIZE_DEBOUNCE_MS = 150

export type PdfDocumentSource =
  | { kind: 'url'; url: string }
  | { kind: 'buffer'; buffer: ArrayBuffer }

interface PdfViewerCoreProps {
  source: PdfDocumentSource
  filename: string
}

function PdfError({ error }: { error: string }) {
  const t = useTranslations('auto')
  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-body)]'>
        {t('failed_to_preview_pdf')}
      </p>
      <p className='text-[13px] text-[var(--text-muted)]'>{error}</p>
    </div>
  )
}

export const PdfViewerCore = memo(function PdfViewerCore({ source, filename }: PdfViewerCoreProps) {
  const tI18n = useTranslations('auto')
  const containerRef = useRef<HTMLDivElement>(null)
  const paddingWrapperRef = useRef<HTMLDivElement>(null)
  const pagesWrapperRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const pageWidthRef = useRef<number | undefined>(undefined)

  const zoomRef = useRef(PDF_ZOOM_DEFAULT)

  const [containerWidth, setContainerWidth] = useState(0)
  const [pageCount, setPageCount] = useState(0)
  const [isDocumentReady, setIsDocumentReady] = useState(false)
  const [displayZoom, setDisplayZoom] = useState(PDF_ZOOM_DEFAULT)
  const [currentPage, setCurrentPage] = useState(1)
  const [loadError, setLoadError] = useState<string | null>(null)

  const sourceValue = source.kind === 'url' ? source.url : source.buffer
  /**
   * The buffer copy (`slice(0)`) is load-bearing: pdf.js transfers — and
   * detaches — the ArrayBuffer it receives to its worker, so handing over the
   * caller's buffer would leave it unusable on the next render or remount.
   */
  const file = useMemo(
    () => (source.kind === 'url' ? source.url : { data: new Uint8Array(source.buffer.slice(0)) }),
    [sourceValue]
  )

  /**
   * The first non-zero measurement applies immediately so the document renders
   * without delay (a hidden container reports zero width and must not consume
   * the immediate slot); subsequent ones (panel-divider drags) are debounced
   * because every pageWidth change makes pdf.js re-rasterise all page canvases
   * — per-tick updates during a drag would re-render the whole document
   * continuously.
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let hasMeasured = false
    let debounce: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect
      if (!hasMeasured) {
        if (width <= 0) return
        hasMeasured = true
        setContainerWidth(width)
        return
      }
      clearTimeout(debounce)
      debounce = setTimeout(() => setContainerWidth(width), PDF_RESIZE_DEBOUNCE_MS)
    })
    observer.observe(container)
    return () => {
      clearTimeout(debounce)
      observer.disconnect()
    }
  }, [])

  /**
   * 100% zoom fits the page to the panel width (pdf.js re-renders the canvas
   * at the target width, so upscaling past the page's natural print size
   * stays crisp). Matches the DOCX preview's fit-to-width semantics.
   */
  const pageWidth = containerWidth > 0 ? containerWidth - 2 * PDF_VIEWER_PADDING : undefined
  pageWidthRef.current = pageWidth

  const applyZoomAt = useCallback((next: number, anchorX: number, anchorY: number) => {
    const container = containerRef.current
    const wrapper = pagesWrapperRef.current
    const padWrapper = paddingWrapperRef.current
    const pw = pageWidthRef.current
    if (!container || !wrapper) return
    const ratio = next / zoomRef.current
    wrapper.style.zoom = String(next)
    if (padWrapper && pw !== undefined) {
      padWrapper.style.minWidth = `${pw * next + 2 * PDF_VIEWER_PADDING}px`
    }
    // Padding is outside the zoom subtree, so offset the anchor by it before scaling.
    container.scrollLeft =
      (container.scrollLeft + anchorX - PDF_VIEWER_PADDING) * ratio + PDF_VIEWER_PADDING - anchorX
    container.scrollTop =
      (container.scrollTop + anchorY - PDF_VIEWER_PADDING) * ratio + PDF_VIEWER_PADDING - anchorY
    zoomRef.current = next
    setDisplayZoom(next)
  }, [])

  const scrollToPage = (page: number) => {
    const container = containerRef.current
    if (container && zoomRef.current !== PDF_ZOOM_DEFAULT) {
      applyZoomAt(PDF_ZOOM_DEFAULT, container.clientWidth / 2, container.clientHeight / 2)
    }

    const wrapper = pageRefs.current[page - 1]
    if (wrapper && container) {
      container.scrollTo({ top: wrapper.offsetTop - 16, behavior: 'smooth' })
    }
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container || pageCount === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageNum = Number((entry.target as HTMLElement).dataset.page)
            if (pageNum) setCurrentPage(pageNum)
          }
        }
      },
      { root: container, threshold: 0.5 }
    )

    for (const wrapper of pageRefs.current) {
      if (wrapper) observer.observe(wrapper)
    }

    return () => observer.disconnect()
  }, [pageCount])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    return bindPreviewWheelZoom(container, (e) => {
      const next = Math.min(
        PDF_ZOOM_MAX,
        Math.max(PDF_ZOOM_MIN, zoomRef.current * (1 - e.deltaY * 0.005))
      )
      const rect = container.getBoundingClientRect()
      applyZoomAt(next, e.clientX - rect.left, e.clientY - rect.top)
    })
  }, [applyZoomAt])

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      {pageCount > 0 && !loadError && (
        <PreviewToolbar
          navigation={{
            current: currentPage,
            total: pageCount,
            label: 'page',
            onPrevious: () => {
              const prev = Math.max(1, currentPage - 1)
              setCurrentPage(prev)
              scrollToPage(prev)
            },
            onNext: () => {
              const next = Math.min(pageCount, currentPage + 1)
              setCurrentPage(next)
              scrollToPage(next)
            },
          }}
          zoom={{
            label: `${Math.round(displayZoom * 100)}%`,
            canZoomOut: displayZoom > PDF_ZOOM_MIN,
            canZoomIn: displayZoom < PDF_ZOOM_MAX,
            onZoomOut: () => {
              const c = containerRef.current
              applyZoomAt(
                Math.max(PDF_ZOOM_MIN, zoomRef.current / PDF_ZOOM_STEP),
                c ? c.clientWidth / 2 : 0,
                c ? c.clientHeight / 2 : 0
              )
            },
            onZoomIn: () => {
              const c = containerRef.current
              applyZoomAt(
                Math.min(PDF_ZOOM_MAX, zoomRef.current * PDF_ZOOM_STEP),
                c ? c.clientWidth / 2 : 0,
                c ? c.clientHeight / 2 : 0
              )
            },
          }}
        />
      )}

      <div
        ref={containerRef}
        className='relative flex flex-1 items-start overflow-auto bg-[var(--surface-1)]'
      >
        {!isDocumentReady && PREVIEW_LOADING_OVERLAY}
        <ReactPdfDocument
          file={file}
          onLoadSuccess={({ numPages }) => {
            setPageCount(numPages)
            setCurrentPage(1)
            setLoadError(null)
            setIsDocumentReady(true)
          }}
          onLoadError={(err) => {
            logger.error('PDF load failed', { error: err.message })
            setLoadError(err.message)
            setIsDocumentReady(true)
          }}
          error={<PdfError error={loadError ?? tI18n('failed_to_load_pdf')} />}
          className='mx-auto'
        >
          <div
            ref={paddingWrapperRef}
            style={{
              padding: PDF_VIEWER_PADDING,
              minWidth:
                pageWidth !== undefined
                  ? `${pageWidth * displayZoom + 2 * PDF_VIEWER_PADDING}px`
                  : undefined,
            }}
          >
            <div ref={pagesWrapperRef} style={{ width: pageWidth }}>
              {Array.from({ length: pageCount }, (_, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    pageRefs.current[i] = el
                  }}
                  data-page={i + 1}
                  className='mb-4 overflow-clip rounded-md shadow-medium'
                >
                  <ReactPdfPage
                    pageNumber={i + 1}
                    width={pageWidth}
                    className='!overflow-clip [&_.textLayer]:!overflow-clip'
                    renderTextLayer
                    renderAnnotationLayer={false}
                    aria-label={`${filename} page ${i + 1}`}
                  />
                </div>
              ))}
            </div>
          </div>
        </ReactPdfDocument>
      </div>
    </div>
  )
})
