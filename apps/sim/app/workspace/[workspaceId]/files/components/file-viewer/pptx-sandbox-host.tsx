'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { openSimPptxViewer, type SimPptxViewerHandle } from '@/lib/pptx-renderer/sim-pptx-viewer'
import { PreviewToolbar } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-toolbar'
import { bindPreviewWheelZoom } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-wheel-zoom'

const logger = createLogger('PptxSandboxHost')

const ZOOM_MIN = 25
const ZOOM_MAX = 400
const ZOOM_STEP = 20
const ZOOM_WHEEL_SENSITIVITY = 0.005

interface PptxSandboxHostProps {
  buffer: ArrayBuffer
  requestId: string
  onRenderStart?: () => void
  onRenderComplete?: () => void
  onRenderError?: (error: string) => void
}

export const PptxSandboxHost = memo(function PptxSandboxHost({
  buffer,
  requestId,
  onRenderStart,
  onRenderComplete,
  onRenderError,
}: PptxSandboxHostProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const activeHandleRef = useRef<SimPptxViewerHandle | null>(null)
  const activeContainerRef = useRef<HTMLDivElement | null>(null)
  const renderSequenceRef = useRef(0)
  const onRenderStartRef = useRef(onRenderStart)
  const onRenderCompleteRef = useRef(onRenderComplete)
  const onRenderErrorRef = useRef(onRenderError)
  const zoomPercentRef = useRef(100)

  onRenderStartRef.current = onRenderStart
  onRenderCompleteRef.current = onRenderComplete
  onRenderErrorRef.current = onRenderError
  const [zoomPercent, setZoomPercent] = useState(100)
  const [slideCount, setSlideCount] = useState(0)
  const [currentSlide, setCurrentSlide] = useState(1)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const controller = new AbortController()
    const sequence = ++renderSequenceRef.current
    const nextContainer = document.createElement('div')
    nextContainer.dataset.requestId = requestId
    nextContainer.style.width = '100%'
    nextContainer.style.visibility = 'hidden'
    stage.appendChild(nextContainer)

    onRenderStartRef.current?.()

    async function render() {
      try {
        const handle = await openSimPptxViewer({
          buffer,
          container: nextContainer,
          scrollContainer: scrollContainerRef.current ?? undefined,
          signal: controller.signal,
          onSlideChange: (index) => setCurrentSlide(index + 1),
          onSlideError: (slideIndex, error) => {
            logger.warn('PPTX slide render failed', {
              slideIndex,
              error: toError(error).message,
            })
          },
        })

        if (controller.signal.aborted || sequence !== renderSequenceRef.current) {
          handle.destroy()
          nextContainer.remove()
          return
        }

        const previousHandle = activeHandleRef.current
        const previousContainer = activeContainerRef.current
        activeHandleRef.current = handle
        activeContainerRef.current = nextContainer
        setSlideCount(handle.viewer.slideCount)
        setCurrentSlide(handle.viewer.currentSlideIndex + 1)
        if (zoomPercentRef.current !== 100) {
          await handle.viewer.setZoom(zoomPercentRef.current)
        }
        nextContainer.style.visibility = 'visible'
        previousHandle?.destroy()
        previousContainer?.remove()
        onRenderCompleteRef.current?.()
      } catch (error) {
        nextContainer.remove()
        if (controller.signal.aborted) return

        const message = toError(error).message || 'Failed to render presentation'
        logger.warn('PPTX render failed', { error: message })
        onRenderErrorRef.current?.(message)
      }
    }

    render()

    return () => {
      controller.abort()
      if (activeContainerRef.current !== nextContainer) {
        nextContainer.remove()
      }
    }
  }, [buffer, requestId])

  useEffect(() => {
    return () => {
      renderSequenceRef.current += 1
      activeHandleRef.current?.destroy()
      activeContainerRef.current?.remove()
    }
  }, [])

  const applyZoomAt = useCallback(async (nextZoom: number, anchorX: number, anchorY: number) => {
    const container = scrollContainerRef.current
    if (!container) return

    const clampedZoom = Math.round(Math.min(Math.max(nextZoom, ZOOM_MIN), ZOOM_MAX))
    const ratio = clampedZoom / zoomPercentRef.current
    const style = window.getComputedStyle(container)
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
    const paddingTop = Number.parseFloat(style.paddingTop) || 0
    const previousScrollLeft = container.scrollLeft
    const previousScrollTop = container.scrollTop

    zoomPercentRef.current = clampedZoom
    setZoomPercent(clampedZoom)
    await activeHandleRef.current?.viewer.setZoom(clampedZoom)

    container.scrollLeft =
      (previousScrollLeft + anchorX - paddingLeft) * ratio + paddingLeft - anchorX
    container.scrollTop = (previousScrollTop + anchorY - paddingTop) * ratio + paddingTop - anchorY
  }, [])

  const applyZoomFromCenter = useCallback(
    (nextZoom: number): Promise<void> => {
      const container = scrollContainerRef.current
      return applyZoomAt(
        nextZoom,
        container ? container.clientWidth / 2 : 0,
        container ? container.clientHeight / 2 : 0
      )
    },
    [applyZoomAt]
  )

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    return bindPreviewWheelZoom(container, (event) => {
      const rect = container.getBoundingClientRect()
      void applyZoomAt(
        zoomPercentRef.current * (1 - event.deltaY * ZOOM_WHEEL_SENSITIVITY),
        event.clientX - rect.left,
        event.clientY - rect.top
      )
    })
  }, [applyZoomAt])

  async function goToSlide(slideNumber: number) {
    if (!activeHandleRef.current || slideCount <= 0) return
    const clampedSlide = Math.min(Math.max(slideNumber, 1), slideCount)
    if (zoomPercentRef.current !== 100) {
      await applyZoomFromCenter(100)
    }
    setCurrentSlide(clampedSlide)
    await activeHandleRef.current.viewer.goToSlide(clampedSlide - 1)
  }

  return (
    <div className='flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[var(--surface-1)]'>
      <PreviewToolbar
        navigation={{
          current: currentSlide,
          total: slideCount,
          label: 'slide',
          canPrevious: slideCount > 0 && currentSlide > 1,
          canNext: slideCount > 0 && currentSlide < slideCount,
          onPrevious: () => goToSlide(currentSlide - 1),
          onNext: () => goToSlide(currentSlide + 1),
        }}
        zoom={{
          label: `${zoomPercent}%`,
          canZoomOut: zoomPercent > ZOOM_MIN,
          canZoomIn: zoomPercent < ZOOM_MAX,
          onReset: () => {
            void applyZoomFromCenter(100)
          },
          onZoomOut: () => {
            void applyZoomFromCenter(zoomPercent - ZOOM_STEP)
          },
          onZoomIn: () => {
            void applyZoomFromCenter(zoomPercent + ZOOM_STEP)
          },
        }}
      />
      <div
        ref={scrollContainerRef}
        className='relative flex min-h-0 flex-1 items-start overflow-auto bg-[var(--surface-1)] px-6 py-6'
      >
        <div ref={stageRef} className='mx-auto w-full max-w-[960px]' />
      </div>
    </div>
  )
})
