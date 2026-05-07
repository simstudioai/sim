'use client'

import type { MouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
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

  const applyZoom = useCallback((nextZoom: number) => {
    zoomRef.current = nextZoom
    setZoom(nextZoom)
    setOffset((currentOffset) =>
      clampOffset(containerSizeRef.current, contentSizeRef.current, currentOffset, nextZoom)
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

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        hasInteractedRef.current = true
        applyZoom(clampZoom(zoomRef.current * Math.exp(-e.deltaY * ZOOM_WHEEL_SENSITIVITY)))
      } else {
        hasInteractedRef.current = true
        setOffset((currentOffset) =>
          clampOffset(
            containerSizeRef.current,
            contentSizeRef.current,
            {
              x: currentOffset.x - e.deltaX,
              y: currentOffset.y - e.deltaY,
            },
            zoomRef.current
          )
        )
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyZoom])

  useLayoutEffect(() => {
    const updateSizes = () => {
      setContainerSize(getElementSize(containerRef.current))
      setContentSize(getElementSize(contentRef.current))
    }
    updateSizes()

    const container = containerRef.current
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

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    hasInteractedRef.current = true
    isDragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    offsetAtDragStart.current = offsetRef.current
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
    e.preventDefault()
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.current) return
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

  const handleMouseUp = () => {
    isDragging.current = false
    if (containerRef.current) containerRef.current.style.cursor = 'grab'
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative cursor-grab overflow-hidden bg-[var(--surface-1)]', className)}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
        <div
          ref={contentRef}
          className={cn('flex items-center justify-center', contentClassName)}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          {children}
        </div>
      </div>
      <div
        className='absolute right-4 bottom-4 flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 shadow-card'
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Button
          variant='ghost'
          size='sm'
          onClick={fitToView}
          className='h-6 px-2 text-[11px]'
          aria-label={initialScale === 'fit' ? 'Fit to view' : 'Reset zoom'}
        >
          {initialScale === 'fit' ? 'Fit' : 'Reset'}
        </Button>
        <Button
          variant='ghost'
          size='sm'
          onClick={zoomOut}
          disabled={zoom <= ZOOM_MIN}
          className='h-6 w-6 p-0'
          aria-label='Zoom out'
        >
          <ZoomOut className='h-3.5 w-3.5' />
        </Button>
        <span className='min-w-[3rem] text-center text-[11px] text-[var(--text-secondary)]'>
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant='ghost'
          size='sm'
          onClick={zoomIn}
          disabled={zoom >= ZOOM_MAX}
          className='h-6 w-6 p-0'
          aria-label='Zoom in'
        >
          <ZoomIn className='h-3.5 w-3.5' />
        </Button>
      </div>
    </div>
  )
}
