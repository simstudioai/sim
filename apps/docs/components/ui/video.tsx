'use client'

import { useEffect, useRef, useState } from 'react'
import { cn, getAssetUrl } from '@/lib/utils'
import { Lightbox } from './lightbox'

interface VideoProps {
  src: string
  className?: string
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  playsInline?: boolean
  enableLightbox?: boolean
  width?: number
  height?: number
}

export function Video({
  src,
  className = 'w-full rounded-xl border border-[var(--border)] overflow-hidden outline-none focus:outline-none',
  autoPlay = true,
  loop = true,
  muted = true,
  playsInline = true,
  enableLightbox = true,
  width,
  height,
}: VideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const startTimeRef = useRef(0)
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)
  const [isInView, setIsInView] = useState(false)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    // `autoPlay` forces browsers to fetch the full file immediately on mount
    // regardless of `preload` - gate the actual load behind the viewport so a
    // page with several of these doesn't pull down every video up front.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const openLightbox = () => {
    startTimeRef.current = videoRef.current?.currentTime ?? 0
    setIsLightboxOpen(true)
  }

  const video = (
    <video
      ref={videoRef}
      autoPlay={isInView && autoPlay}
      loop={loop}
      muted={muted}
      playsInline={playsInline}
      preload='none'
      width={width}
      height={height}
      className={cn(
        className,
        enableLightbox && 'cursor-pointer transition-opacity group-hover:opacity-[0.97]'
      )}
      src={isInView ? getAssetUrl(src) : undefined}
    />
  )

  return (
    <>
      {enableLightbox ? (
        <button
          type='button'
          onClick={openLightbox}
          aria-label={`Open ${src} in media viewer`}
          className='group contents'
        >
          {video}
        </button>
      ) : (
        video
      )}

      {enableLightbox && (
        <Lightbox
          isOpen={isLightboxOpen}
          onClose={() => setIsLightboxOpen(false)}
          src={src}
          alt={`Video: ${src}`}
          type='video'
          startTime={startTimeRef.current}
        />
      )}
    </>
  )
}
