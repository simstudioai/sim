'use client'

import {
  type ComponentProps,
  type ReactElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  bindPreviewWheelZoom,
  Chip,
  chipFieldSurfaceClass,
  cn,
  Modal,
  ModalClose,
  ModalContent,
  ModalTrigger,
  Slider,
} from '@sim/emcn'
import { Minus, Plus } from '@sim/emcn/icons'

export interface LightboxProps {
  /** A button that opens the viewer. */
  children: ReactElement
  src: string
  alt: string
  type?: 'image' | 'video'
  /** Displayed until the recording's first frame is ready. */
  poster?: string
  /** Reviewed English captions for a recording with speech. */
  captionsSrc?: string
  /** Opt into CORS when the media server supports it. */
  crossOrigin?: ComponentProps<'video'>['crossOrigin']
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

function formatPlaybackTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`
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
export function Lightbox({
  children,
  src,
  alt,
  type = 'image',
  poster,
  captionsSrc,
  crossOrigin,
  startTime = 0,
}: LightboxProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const mediaFrameRef = useRef<HTMLButtonElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null)
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const playbackTime = Math.min(currentTime, duration)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      zoomAnchorRef.current = null
      setZoom(1)
      setPlaying(false)
      setMuted(true)
      setDuration(0)
      setCurrentTime(0)
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
                    ref={videoRef}
                    src={src}
                    poster={poster}
                    aria-label={alt}
                    autoPlay
                    loop
                    muted={muted}
                    playsInline
                    crossOrigin={crossOrigin}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onDurationChange={(event) => {
                      const nextDuration = event.currentTarget.duration
                      setDuration(
                        Number.isFinite(nextDuration) && nextDuration > 0 ? nextDuration : 0
                      )
                    }}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget
                      if (Number.isFinite(startTime) && startTime > 0) {
                        video.currentTime = Number.isFinite(video.duration)
                          ? Math.min(startTime, video.duration)
                          : startTime
                      }
                      setCurrentTime(video.currentTime)
                      centerViewport(viewportRef.current)
                    }}
                    className={cn(MEDIA_CLASS, 'max-h-[calc(100dvh-9rem)]')}
                    style={{ zoom }}
                  >
                    {captionsSrc ? (
                      <track
                        kind='captions'
                        src={captionsSrc}
                        srcLang='en'
                        label='English'
                        default
                      />
                    ) : null}
                  </video>
                )}
              </button>
            </ModalClose>
          </div>
        </div>
        <div
          ref={controlsRef}
          role='group'
          aria-label={type === 'video' ? 'Media controls' : 'Media zoom'}
          className={cn(
            chipFieldSurfaceClass,
            'mx-auto flex max-w-[92vw] shrink-0 flex-wrap items-center justify-center p-1 shadow-[var(--shadow-overlay)]',
            type === 'video' && 'w-80'
          )}
        >
          {type === 'video' ? (
            <>
              <div className='flex w-full items-center gap-3 px-3 text-[var(--text-body)] text-caption'>
                <span className='shrink-0 tabular-nums'>{formatPlaybackTime(playbackTime)}</span>
                <Slider
                  aria-label='Seek video'
                  aria-valuetext={`${formatPlaybackTime(playbackTime)} of ${formatPlaybackTime(duration)}`}
                  min={0}
                  max={duration || 1}
                  step={1}
                  value={[playbackTime]}
                  disabled={duration <= 0}
                  onValueChange={([value]) => {
                    const video = videoRef.current
                    if (!video || value === undefined || !Number.isFinite(value) || duration <= 0) {
                      return
                    }
                    video.currentTime = Math.min(duration, Math.max(0, value))
                    setCurrentTime(video.currentTime)
                  }}
                  className='h-11 min-w-0 flex-1'
                />
                <span className='shrink-0 tabular-nums'>{formatPlaybackTime(duration)}</span>
              </div>
              <Chip
                onClick={() => {
                  const video = videoRef.current
                  if (!video) return
                  if (video.paused) void video.play().catch(() => setPlaying(false))
                  else video.pause()
                }}
              >
                {playing ? 'Pause' : 'Play'}
              </Chip>
              {captionsSrc ? (
                <Chip onClick={() => setMuted(!muted)}>{muted ? 'Unmute' : 'Mute'}</Chip>
              ) : null}
            </>
          ) : null}
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
