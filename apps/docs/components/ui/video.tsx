'use client'

import { useRef, useState } from 'react'
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
  className = 'w-full rounded-xl border border-border overflow-hidden outline-none focus:outline-none',
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

  const openLightbox = () => {
    startTimeRef.current = videoRef.current?.currentTime ?? 0
    setIsLightboxOpen(true)
  }

  const video = (
    <video
      ref={videoRef}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      playsInline={playsInline}
      width={width}
      height={height}
      className={cn(className, enableLightbox && 'transition-opacity group-hover:opacity-[0.97]')}
      src={getAssetUrl(src)}
    />
  )

  return (
    <>
      {enableLightbox ? (
        <button
          type='button'
          onClick={openLightbox}
          aria-label={`Open ${src} in media viewer`}
          className='group block w-full cursor-pointer rounded-xl p-0 text-left'
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
