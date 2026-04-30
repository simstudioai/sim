'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/emcn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_WHEEL_SENSITIVITY = 0.005
const ZOOM_BUTTON_FACTOR = 1.2

const clampZoom = (z: number) => Math.min(Math.max(z, ZOOM_MIN), ZOOM_MAX)

export const ImagePreview = memo(function ImagePreview({ file }: { file: WorkspaceFileRecord }) {
  const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const offsetAtDragStart = useRef({ x: 0, y: 0 })
  const offsetRef = useRef(offset)
  offsetRef.current = offset

  const containerRef = useRef<HTMLDivElement>(null)

  const zoomIn = () => setZoom((z) => clampZoom(z * ZOOM_BUTTON_FACTOR))
  const zoomOut = () => setZoom((z) => clampZoom(z / ZOOM_BUTTON_FACTOR))

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * ZOOM_WHEEL_SENSITIVITY)))
      } else {
        setOffset((o) => ({ x: o.x - e.deltaX, y: o.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    isDragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    offsetAtDragStart.current = offsetRef.current
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
    e.preventDefault()
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return
    setOffset({
      x: offsetAtDragStart.current.x + (e.clientX - dragStart.current.x),
      y: offsetAtDragStart.current.y + (e.clientY - dragStart.current.y),
    })
  }

  const handleMouseUp = () => {
    isDragging.current = false
    if (containerRef.current) containerRef.current.style.cursor = 'grab'
  }

  return (
    <div
      ref={containerRef}
      className='relative flex flex-1 cursor-grab overflow-hidden bg-[var(--surface-1)]'
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className='pointer-events-none absolute inset-0 flex items-center justify-center'
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        <img
          src={serveUrl}
          alt={file.name}
          className='max-h-full max-w-full select-none rounded-md object-contain'
          draggable={false}
          loading='eager'
        />
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
})
