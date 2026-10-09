'use client'

import type { PointerEvent, ReactNode } from 'react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { bindPreviewWheelZoom, cn } from '@sim/emcn'
import { PreviewToolbar } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-toolbar'

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

interface ZoomablePreviewProps {
  children: ReactNode
  className?: string
  contentClassName?: string
  initialScale?: 'actual' | 'fit'
  resetKey?: string | number
}

function getElementSize(element: HTMLElement | null): Size {
  if (!element) return { width: 0, height: 0 }
  return {
    width: element.offsetWidth,
    height: element.offsetHeight,
  }
}

function getFitZoom(container: Size, content: Size): number {
  if (container.width <= 0 || container.height <= 0 || content.width <= 0 || content.height <= 0) {
    return 1
  }

  const availableWidth = Math.max(1, container.width - FIT_PADDING)
  const availableHeight = Math.max(1, container.height - FIT_PADDING)
  return clampZoom(Math.min(availableWidth / content.width, availableHeight / content.height))
}

function clampOffset(container: Size, content: Size, offset: Offset, zoom: number): Offset {
  if (container.width <= 0 || container.height <= 0 || content.width <= 0 || content.height <= 0) {
    return offset
  }

  const scaledWidth = content.width * zoom
  const scaledHeight = content.height * zoom
  const maxX = Math.max(0, (scaledWidth - container.width) / 2)
  const maxY = Math.max(0, (scaledHeight - container.height) / 2)

  return {
    x: Math.min(Math.max(offset.x, -maxX), maxX),
    y: Math.min(Math.max(offset.y, -maxY), maxY),
  }
}

export function ZoomablePreview({
  children,
  className,
  contentClassName,
  initialScale = 'actual',
  resetKey,
}: ZoomablePreviewProps) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 })
  const [contentSize, setContentSize] = useState<Size>({ width: 0, height: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const dragStart = useRef({ x: 0, y: 0 })
  const offsetAtDragStart = useRef({ x: 0, y: 0 })
  const hasInteractedRef = useRef(false)
  const zoomRef = useRef(zoom)
  const offsetRef = useRef(offset)
  const containerSizeRef = useRef(containerSize)
  const contentSizeRef = useRef(contentSize)
  zoomRef.current = zoom
  offsetRef.current = offset
  containerSizeRef.current = containerSize
  contentSizeRef.current = contentSize

  const applyZoom = useCallback((nextZoom: number, anchorX?: number, anchorY?: number) => {
    const currentZoom = zoomRef.current
    const ratio = nextZoom / currentZoom
    const container = containerSizeRef.current
    const anchorFromCenter = {
      x: (anchorX ?? container.width / 2) - container.width / 2,
      y: (anchorY ?? container.height / 2) - container.height / 2,
    }

    zoomRef.current = nextZoom
    setZoom(nextZoom)
    setOffset((currentOffset) =>
      clampOffset(
        container,
        contentSizeRef.current,
        {
          x: currentOffset.x * ratio + anchorFromCenter.x * (1 - ratio),
          y: currentOffset.y * ratio + anchorFromCenter.y * (1 - ratio),
        },
        nextZoom
      )
    )
  }, [])

  const fitToView = useCallback(() => {
    hasInteractedRef.current = false
    const nextZoom =
      initialScale === 'fit' ? getFitZoom(containerSizeRef.current, contentSizeRef.current) : 1
    zoomRef.current = nextZoom
    setZoom(nextZoom)
    setOffset({ x: 0, y: 0 })
  }, [initialScale])

  const zoomIn = () => {
    hasInteractedRef.current = true
    applyZoom(clampZoom(zoom * ZOOM_BUTTON_FACTOR))
  }
  const zoomOut = () => {
    hasInteractedRef.current = true
    applyZoom(clampZoom(zoom / ZOOM_BUTTON_FACTOR))
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    return bindPreviewWheelZoom(
      viewport,
      (event) => {
        hasInteractedRef.current = true
        const rect = viewport.getBoundingClientRect()
        applyZoom(
          clampZoom(zoomRef.current * Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY)),
          event.clientX - rect.left,
          event.clientY - rect.top
        )
      },
      {
        onPan: (event) => {
          hasInteractedRef.current = true
          setOffset((currentOffset) =>
            clampOffset(
              containerSizeRef.current,
              contentSizeRef.current,
              {
                x: currentOffset.x - event.deltaX,
                y: currentOffset.y - event.deltaY,
              },
              zoomRef.current
            )
          )
        },
      }
    )
  }, [applyZoom])

  useLayoutEffect(() => {
    const updateSizes = () => {
      setContainerSize(getElementSize(viewportRef.current))
      setContentSize(getElementSize(contentRef.current))
    }
    updateSizes()

    const container = viewportRef.current
    const content = contentRef.current
    if (!container || !content) return

    const observer = new ResizeObserver(() => {
      updateSizes()
    })
    observer.observe(container)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (
      containerSize.width <= 0 ||
      containerSize.height <= 0 ||
      contentSize.width <= 0 ||
      contentSize.height <= 0
    ) {
      return
    }

    const nextZoom =
      initialScale === 'fit' && !hasInteractedRef.current
        ? getFitZoom(containerSize, contentSize)
        : zoomRef.current
    zoomRef.current = nextZoom
    setZoom(nextZoom)
    setOffset((currentOffset) => clampOffset(containerSize, contentSize, currentOffset, nextZoom))
  }, [containerSize, contentSize, initialScale])

  useLayoutEffect(() => {
    hasInteractedRef.current = false
    const nextZoom =
      initialScale === 'fit' ? getFitZoom(containerSizeRef.current, contentSizeRef.current) : 1
    zoomRef.current = nextZoom
    setZoom(nextZoom)
    setOffset({ x: 0, y: 0 })
  }, [initialScale, resetKey])

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || activePointerIdRef.current !== null || !e.isPrimary) return
    hasInteractedRef.current = true
    activePointerIdRef.current = e.pointerId
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = { x: e.clientX, y: e.clientY }
    offsetAtDragStart.current = offsetRef.current
    if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing'
    e.preventDefault()
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return
    setOffset(
      clampOffset(
        containerSizeRef.current,
        contentSizeRef.current,
        {
          x: offsetAtDragStart.current.x + (e.clientX - dragStart.current.x),
          y: offsetAtDragStart.current.y + (e.clientY - dragStart.current.y),
        },
        zoom
      )
    )
  }

  const handlePointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return
    activePointerIdRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (viewportRef.current) viewportRef.current.style.cursor = 'grab'
  }

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden bg-[var(--surface-1)]', className)}>
      <PreviewToolbar
        zoom={{
          label: `${Math.round(zoom * 100)}%`,
          canZoomOut: zoom > ZOOM_MIN,
          canZoomIn: zoom < ZOOM_MAX,
          onReset: fitToView,
          onZoomOut: zoomOut,
          onZoomIn: zoomIn,
        }}
      />
      <div
        ref={viewportRef}
        role='application'
        aria-label='Zoomable preview'
        className='relative min-h-0 flex-1 cursor-grab touch-pinch-zoom overflow-hidden'
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
      >
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <div
            ref={contentRef}
            className={cn(
              'flex items-center justify-center',
              (zoom !== 1 || offset.x !== 0 || offset.y !== 0) && 'will-change-transform',
              contentClassName
            )}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
