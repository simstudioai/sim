'use client'

import { type ReactElement, useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  bindPreviewWheelZoom,
  Chip,
  chipFieldSurfaceClass,
  cn,
  Modal,
  ModalClose,
  ModalContent,
  ModalTrigger,
} from '@sim/emcn'
import { Minus, Plus } from '@sim/emcn/icons'

export interface LightboxProps {
  /** A button that opens the viewer. */
  children: ReactElement
  src: string
  alt: string
  type?: 'image' | 'video'
  /** Playback position to resume when a video opens. */
  startTime?: number
}

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25
const ZOOM_WHEEL_SENSITIVITY = 0.005
const MEDIA_CLASS = 'block h-auto max-h-[calc(100dvh-6rem)] w-auto max-w-[92vw] object-contain'

interface ZoomAnchor {
  clientX: number
  clientY: number
  fractionX: number
  fractionY: number
}

function centerViewport(viewport: HTMLDivElement | null) {
  if (!viewport) return
  viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2
  viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2
}

/**
 * A click-to-close media viewer with bottom zoom controls, the platform's modal
 * focus trap, Escape dismissal, and focus restoration to its trigger.
 *
 * @example
 * ```tsx
 * <Lightbox src={src} alt='Screenshot'>
 *   <button type='button'><img src={src} alt='Screenshot' /></button>
 * </Lightbox>
 * ```
 */
export function Lightbox({ children, src, alt, type = 'image', startTime = 0 }: LightboxProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const mediaFrameRef = useRef<HTMLButtonElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null)
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      zoomAnchorRef.current = null
      setZoom(1)
    }
    setOpen(nextOpen)
  }

  function handleControlZoom(nextZoom: number) {
    zoomAnchorRef.current = null
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextZoom)))
  }

  const attachViewport = useCallback((viewport: HTMLDivElement | null) => {
    viewportRef.current = viewport
    if (!viewport) return

    const unbind = bindPreviewWheelZoom(viewport, (event) => {
      const frame = mediaFrameRef.current?.getBoundingClientRect()
      if (frame && frame.width > 0 && frame.height > 0) {
        zoomAnchorRef.current = {
          clientX: event.clientX,
          clientY: event.clientY,
          fractionX: (event.clientX - frame.left) / frame.width,
          fractionY: (event.clientY - frame.top) / frame.height,
        }
      }
      setZoom((current) =>
        Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, current * Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY))
        )
      )
    })

    return () => {
      unbind()
      viewportRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const anchor = zoomAnchorRef.current
    const frame = mediaFrameRef.current?.getBoundingClientRect()
    if (viewport && anchor && frame) {
      viewport.scrollLeft += frame.left + anchor.fractionX * frame.width - anchor.clientX
      viewport.scrollTop += frame.top + anchor.fractionY * frame.height - anchor.clientY
    } else {
      centerViewport(viewport)
    }
    zoomAnchorRef.current = null
  }, [open, zoom])

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalTrigger asChild>{children}</ModalTrigger>
      <ModalContent
        bare
        size='full'
        srTitle={alt || 'Media viewer'}
        overlayClassName='bg-black/80'
        className='h-dvh max-h-none w-screen min-w-full max-w-none gap-3 py-4 outline-none'
        onClick={(event) => {
          if (!controlsRef.current?.contains(event.target as Node)) setOpen(false)
        }}
      >
        <div ref={attachViewport} className='min-h-0 flex-1 overflow-auto overscroll-contain'>
          <div className='flex min-h-full w-max min-w-full items-center justify-center'>
            <ModalClose asChild>
              <button
                ref={mediaFrameRef}
                type='button'
                aria-label='Close media viewer'
                className='m-1 block shrink-0 cursor-pointer overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0 shadow-[var(--shadow-overlay)] outline-none'
              >
                {type === 'image' ? (
                  <img
                    src={src}
                    alt={alt}
                    draggable={false}
                    onLoad={() => centerViewport(viewportRef.current)}
                    className={MEDIA_CLASS}
                    style={{ zoom }}
                  />
                ) : (
                  <video
                    src={src}
                    aria-label={alt}
                    autoPlay
                    loop
                    muted
                    playsInline
                    onLoadedMetadata={(event) => {
                      if (startTime > 0) event.currentTarget.currentTime = startTime
                      centerViewport(viewportRef.current)
                    }}
                    className={MEDIA_CLASS}
                    style={{ zoom }}
                  />
                )}
              </button>
            </ModalClose>
          </div>
        </div>
        <div
          ref={controlsRef}
          role='group'
          aria-label='Media zoom'
          className={cn(
            chipFieldSurfaceClass,
            'mx-auto flex shrink-0 items-center p-1 shadow-[var(--shadow-overlay)]'
          )}
        >
          <Chip
            leftIcon={Minus}
            aria-label='Zoom out'
            disabled={zoom <= ZOOM_MIN}
            onClick={() => handleControlZoom(zoom - ZOOM_STEP)}
          />
          <Chip
            aria-label={`Reset zoom (${Math.round(zoom * 100)}%)`}
            onClick={() => handleControlZoom(1)}
            className='min-w-16 text-center tabular-nums'
          >
            {Math.round(zoom * 100)}%
          </Chip>
          <Chip
            leftIcon={Plus}
            aria-label='Zoom in'
            disabled={zoom >= ZOOM_MAX}
            onClick={() => handleControlZoom(zoom + ZOOM_STEP)}
          />
        </div>
      </ModalContent>
    </Modal>
  )
}
