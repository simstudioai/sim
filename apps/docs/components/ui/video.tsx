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

  const handleVideoClick = () => {
    if (enableLightbox) {
      startTimeRef.current = videoRef.current?.currentTime ?? 0
      setIsLightboxOpen(true)
    }
  }

  return (
    <>
      <video
        ref={videoRef}
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline={playsInline}
        width={width}
        height={height}
        className={cn(
          className,
          enableLightbox && 'cursor-pointer transition-opacity hover:opacity-95'
        )}
        src={getAssetUrl(src)}
        onClick={handleVideoClick}
      />

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
