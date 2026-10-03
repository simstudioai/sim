'use client'

import { useEffect, useRef, useState } from 'react'
import { Lightbox } from '@sim/emcn'
import { cn, getAssetUrl } from '@/lib/utils'

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
  className = 'w-full',
  autoPlay = true,
  loop = true,
  muted = true,
  playsInline = true,
  enableLightbox = true,
  width,
  height,
}: VideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [startTime, setStartTime] = useState(0)
  const [isInView, setIsInView] = useState(false)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      setIsInView(true)
      return
    }

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
    setStartTime(videoRef.current?.currentTime ?? 0)
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
        'overflow-hidden rounded-xl border border-[var(--border)] outline-none focus:outline-none',
        enableLightbox && 'cursor-pointer transition-opacity group-hover:opacity-[0.97]',
        className
      )}
      src={isInView ? getAssetUrl(src) : undefined}
    />
  )

  if (!enableLightbox) return video

  return (
    <Lightbox src={getAssetUrl(src)} alt={`Video: ${src}`} type='video' startTime={startTime}>
      <button
        type='button'
        onClick={openLightbox}
        aria-label={`Open ${src} in media viewer`}
        className='group contents'
      >
        {video}
      </button>
    </Lightbox>
  )
}
