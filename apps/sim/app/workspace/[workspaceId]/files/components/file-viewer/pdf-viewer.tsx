'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { pdfjs, Document as ReactPdfDocument, Page as ReactPdfPage } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import { Button, Skeleton } from '@/components/emcn'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

const logger = createLogger('PdfViewer')

const PDF_ZOOM_MIN = 0.5
const PDF_ZOOM_MAX = 3
const PDF_ZOOM_DEFAULT = 1
const PDF_ZOOM_STEP = 1.25
const PDF_PAGE_MAX_WIDTH = 816
const PDF_VIEWER_PADDING = 24

export type PdfDocumentSource =
  | { kind: 'url'; url: string }
  | { kind: 'buffer'; buffer: ArrayBuffer }

interface PdfViewerCoreProps {
  source: PdfDocumentSource
  filename: string
}

const PDF_SKELETON = (
  <div className='absolute inset-0 flex flex-col items-center gap-4 overflow-y-auto bg-[var(--surface-1)] p-6'>
    {[0, 1].map((i) => (
      <div
        key={i}
        className='w-full max-w-[640px] shrink-0 rounded-md bg-[var(--surface-2)] p-8 shadow-medium'
        style={{ aspectRatio: '1 / 1.414' }}
      >
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-[14px] w-[60%]' />
          <Skeleton className='h-[14px] w-[80%]' />
          <Skeleton className='h-[14px] w-[55%]' />
          <Skeleton className='mt-2 h-[14px] w-[75%]' />
          <Skeleton className='h-[14px] w-[65%]' />
          <Skeleton className='h-[14px] w-[85%]' />
          <Skeleton className='h-[14px] w-[50%]' />
        </div>
      </div>
    ))}
  </div>
)

function PdfError({ error }: { error: string }) {
  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-body)]'>Failed to preview PDF</p>
      <p className='text-[13px] text-[var(--text-muted)]'>{error}</p>
    </div>
  )
}

export const PdfViewerCore = memo(function PdfViewerCore({ source, filename }: PdfViewerCoreProps) {
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
  const file = useMemo(
    () => (source.kind === 'url' ? source.url : { data: new Uint8Array(source.buffer) }),
    [sourceValue]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const pageWidth =
    containerWidth > 0
      ? Math.min(containerWidth - 2 * PDF_VIEWER_PADDING, PDF_PAGE_MAX_WIDTH)
      : undefined
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
    const wrapper = pageRefs.current[page - 1]
    if (wrapper && containerRef.current) {
      containerRef.current.scrollTo({ top: wrapper.offsetTop - 16, behavior: 'smooth' })
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

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()

      const next = Math.min(
        PDF_ZOOM_MAX,
        Math.max(PDF_ZOOM_MIN, zoomRef.current * (1 - e.deltaY * 0.005))
      )
      const rect = container.getBoundingClientRect()
      applyZoomAt(next, e.clientX - rect.left, e.clientY - rect.top)
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [applyZoomAt])

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      {pageCount > 0 && !loadError && (
        <div className='flex shrink-0 items-center justify-between border-[var(--border)] border-b bg-[var(--surface-1)] px-3 py-1.5'>
          <div className='flex items-center gap-1'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                const prev = Math.max(1, currentPage - 1)
                setCurrentPage(prev)
                scrollToPage(prev)
              }}
              disabled={currentPage <= 1}
              className='h-6 w-6 p-0 text-[var(--text-icon)]'
              aria-label='Previous page'
            >
              <ChevronLeft className='h-[14px] w-[14px]' />
            </Button>
            <span className='min-w-[5rem] text-center text-[12px] text-[var(--text-secondary)]'>
              {currentPage} / {pageCount}
            </span>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                const next = Math.min(pageCount, currentPage + 1)
                setCurrentPage(next)
                scrollToPage(next)
              }}
              disabled={currentPage >= pageCount}
              className='h-6 w-6 p-0 text-[var(--text-icon)]'
              aria-label='Next page'
            >
              <ChevronRight className='h-[14px] w-[14px]' />
            </Button>
          </div>

          <div className='flex items-center gap-1'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                const c = containerRef.current
                applyZoomAt(
                  Math.max(PDF_ZOOM_MIN, zoomRef.current / PDF_ZOOM_STEP),
                  c ? c.clientWidth / 2 : 0,
                  c ? c.clientHeight / 2 : 0
                )
              }}
              disabled={displayZoom <= PDF_ZOOM_MIN}
              className='h-6 w-6 p-0 text-[var(--text-icon)]'
              aria-label='Zoom out'
            >
              <ZoomOut className='h-[14px] w-[14px]' />
            </Button>
            <span className='min-w-[3rem] text-center text-[12px] text-[var(--text-secondary)]'>
              {Math.round(displayZoom * 100)}%
            </span>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                const c = containerRef.current
                applyZoomAt(
                  Math.min(PDF_ZOOM_MAX, zoomRef.current * PDF_ZOOM_STEP),
                  c ? c.clientWidth / 2 : 0,
                  c ? c.clientHeight / 2 : 0
                )
              }}
              disabled={displayZoom >= PDF_ZOOM_MAX}
              className='h-6 w-6 p-0 text-[var(--text-icon)]'
              aria-label='Zoom in'
            >
              <ZoomIn className='h-[14px] w-[14px]' />
            </Button>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className='relative flex flex-1 items-start overflow-auto bg-[var(--surface-1)]'
      >
        {!isDocumentReady && PDF_SKELETON}
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
          error={<PdfError error={loadError ?? 'Failed to load PDF'} />}
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
