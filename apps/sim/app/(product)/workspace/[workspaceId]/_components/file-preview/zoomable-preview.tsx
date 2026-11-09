'use client'

import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { PreviewToolbar } from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/preview-toolbar'
import { bindWheelZoom } from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/preview-wheel'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/zoomable-preview.module.css'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_WHEEL_SENSITIVITY = 0.005
const ZOOM_BUTTON_FACTOR = 1.2
const FIT_PADDING = 48

const clampZoom = (zoom: number) => Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX)

interface Offset {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

function elementSize(element: HTMLElement | null): Size {
  return element
    ? { width: element.offsetWidth, height: element.offsetHeight }
    : { width: 0, height: 0 }
}

function hasArea(size: Size) {
  return size.width > 0 && size.height > 0
}

function fitZoom(container: Size, content: Size): number {
  if (!hasArea(container) || !hasArea(content)) return 1
  const width = Math.max(1, container.width - FIT_PADDING)
  const height = Math.max(1, container.height - FIT_PADDING)
  return clampZoom(Math.min(width / content.width, height / content.height))
}

function clampOffset(container: Size, content: Size, offset: Offset, zoom: number): Offset {
  if (!hasArea(container) || !hasArea(content)) return offset
  const maxX = Math.max(0, (content.width * zoom - container.width) / 2)
  const maxY = Math.max(0, (content.height * zoom - container.height) / 2)
  return {
    x: Math.min(Math.max(offset.x, -maxX), maxX),
    y: Math.min(Math.max(offset.y, -maxY), maxY),
  }
}

interface ZoomablePreviewProps {
  children: ReactNode
  /** `fit` scales the content to the frame until the reader zooms; `actual` starts at 100%. */
  initialScale?: 'actual' | 'fit'
}

/** A zoomable, pannable canvas for an image or diagram: 25–400%, wheel or pinch, drag to pan. */
export function ZoomablePreview({ children, initialScale = 'actual' }: ZoomablePreviewProps) {
  const [zoom, setZoom] = useState(1)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(1)
  const offsetRef = useRef<Offset>({ x: 0, y: 0 })
  const sizesRef = useRef<{ container: Size; content: Size }>({
    container: { width: 0, height: 0 },
    content: { width: 0, height: 0 },
  })
  const interactedRef = useRef(false)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; from: Offset } | null>(null)

  /** The transform is set on the element itself: it follows every pointer move. */
  const paint = useCallback((nextZoom: number, nextOffset: Offset) => {
    zoomRef.current = nextZoom
    offsetRef.current = nextOffset
    const content = contentRef.current
    if (content)
      content.style.transform = `translate(${nextOffset.x}px, ${nextOffset.y}px) scale(${nextZoom})`
    setZoom(nextZoom)
  }, [])

  const applyZoom = useCallback(
    (nextZoom: number, anchorX?: number, anchorY?: number) => {
      const { container, content } = sizesRef.current
      const ratio = nextZoom / zoomRef.current
      const fromCenterX = (anchorX ?? container.width / 2) - container.width / 2
      const fromCenterY = (anchorY ?? container.height / 2) - container.height / 2
      const offset = offsetRef.current
      paint(
        nextZoom,
        clampOffset(
          container,
          content,
          {
            x: offset.x * ratio + fromCenterX * (1 - ratio),
            y: offset.y * ratio + fromCenterY * (1 - ratio),
          },
          nextZoom
        )
      )
    },
    [paint]
  )

  const reset = useCallback(() => {
    interactedRef.current = false
    const { container, content } = sizesRef.current
    paint(initialScale === 'fit' ? fitZoom(container, content) : 1, { x: 0, y: 0 })
  }, [initialScale, paint])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    return bindWheelZoom(
      viewport,
      (event) => {
        interactedRef.current = true
        const rect = viewport.getBoundingClientRect()
        applyZoom(
          clampZoom(zoomRef.current * Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY)),
          event.clientX - rect.left,
          event.clientY - rect.top
        )
      },
      (event) => {
        interactedRef.current = true
        const { container, content } = sizesRef.current
        const offset = offsetRef.current
        paint(
          zoomRef.current,
          clampOffset(
            container,
            content,
            { x: offset.x - event.deltaX, y: offset.y - event.deltaY },
            zoomRef.current
          )
        )
      }
    )
  }, [applyZoom, paint])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    const measure = () => {
      const sizes = { container: elementSize(viewport), content: elementSize(content) }
      sizesRef.current = sizes
      if (!hasArea(sizes.container) || !hasArea(sizes.content)) return
      const nextZoom =
        initialScale === 'fit' && !interactedRef.current
          ? fitZoom(sizes.container, sizes.content)
          : zoomRef.current
      paint(nextZoom, clampOffset(sizes.container, sizes.content, offsetRef.current, nextZoom))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(content)
    return () => observer.disconnect()
  }, [initialScale, paint])

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragRef.current || !event.isPrimary) return
    interactedRef.current = true
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      from: offsetRef.current,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.dragging = ''
    event.preventDefault()
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag?.pointerId !== event.pointerId) return
    const { container, content } = sizesRef.current
    paint(
      zoomRef.current,
      clampOffset(
        container,
        content,
        { x: drag.from.x + event.clientX - drag.x, y: drag.from.y + event.clientY - drag.y },
        zoomRef.current
      )
    )
  }

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    delete event.currentTarget.dataset.dragging
  }

  return (
    <div className={styles.frame}>
      <PreviewToolbar
        zoom={{
          label: `${Math.round(zoom * 100)}%`,
          canZoomOut: zoom > ZOOM_MIN,
          canZoomIn: zoom < ZOOM_MAX,
          onReset: reset,
          onZoomOut: () => {
            interactedRef.current = true
            applyZoom(clampZoom(zoomRef.current / ZOOM_BUTTON_FACTOR))
          },
          onZoomIn: () => {
            interactedRef.current = true
            applyZoom(clampZoom(zoomRef.current * ZOOM_BUTTON_FACTOR))
          },
        }}
      />
      <div
        ref={viewportRef}
        role='application'
        aria-label='Zoomable preview'
        className={styles.viewport}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
      >
        <div className={styles.stage}>
          <div
            ref={contentRef}
            className={styles.content}
            data-fit={initialScale === 'fit' || undefined}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
