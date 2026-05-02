'use client'

import type { MouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_WHEEL_SENSITIVITY = 0.005
const ZOOM_BUTTON_FACTOR = 1.2

const clampZoom = (zoom: number) => Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX)

interface Offset {
  x: number
  y: number
}

interface ZoomablePreviewProps {
  children: ReactNode
  className?: string
  contentClassName?: string
}

function clampOffset(container: HTMLDivElement | null, offset: Offset, zoom: number): Offset {
  if (!container) return offset

  const maxX = Math.max(0, (container.clientWidth * zoom - container.clientWidth) / 2)
  const maxY = Math.max(0, (container.clientHeight * zoom - container.clientHeight) / 2)

  return {
    x: Math.min(Math.max(offset.x, -maxX), maxX),
    y: Math.min(Math.max(offset.y, -maxY), maxY),
  }
}

export function ZoomablePreview({ children, className, contentClassName }: ZoomablePreviewProps) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const offsetAtDragStart = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(zoom)
  const offsetRef = useRef(offset)
  zoomRef.current = zoom
  offsetRef.current = offset

  const applyZoom = useCallback((nextZoom: number) => {
    zoomRef.current = nextZoom
    setZoom(nextZoom)
    setOffset((currentOffset) => clampOffset(containerRef.current, currentOffset, nextZoom))
  }, [])

  const zoomIn = () => applyZoom(clampZoom(zoom * ZOOM_BUTTON_FACTOR))
  const zoomOut = () => applyZoom(clampZoom(zoom / ZOOM_BUTTON_FACTOR))

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        applyZoom(clampZoom(zoomRef.current * Math.exp(-e.deltaY * ZOOM_WHEEL_SENSITIVITY)))
      } else {
        setOffset((currentOffset) =>
          clampOffset(
            el,
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

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      setOffset((currentOffset) => clampOffset(el, currentOffset, zoomRef.current))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return
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
        containerRef.current,
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
      <div
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center',
          contentClassName
        )}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
      <div
        className='absolute right-4 bottom-4 flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 shadow-card'
        onMouseDown={(e) => e.stopPropagation()}
      >
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
