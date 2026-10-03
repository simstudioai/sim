'use client'

import { useRef, useState } from 'react'
import { Lightbox } from '@sim/emcn'
import { cn, getAssetUrl } from '@/lib/utils'

interface ActionImageProps {
  src: string
  alt: string
  enableLightbox?: boolean
}

interface ActionVideoProps {
  src: string
  alt: string
  enableLightbox?: boolean
}

export function ActionImage({ src, alt, enableLightbox = true }: ActionImageProps) {
  const image = (
    <img
      src={src}
      alt={alt}
      className={cn(
        'inline-block w-full max-w-[200px] rounded-lg border border-[var(--border-1)]',
        enableLightbox && 'transition-opacity group-hover:opacity-90'
      )}
    />
  )

  if (!enableLightbox) return image

  return (
    <Lightbox src={src} alt={alt}>
      <button
        type='button'
        aria-label={`Open ${alt} in media viewer`}
        className='group inline-block cursor-pointer rounded p-0 text-left'
      >
        {image}
      </button>
    </Lightbox>
  )
}

export function ActionVideo({ src, alt, enableLightbox = true }: ActionVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [startTime, setStartTime] = useState(0)
  const resolvedSrc = getAssetUrl(src)

  const openLightbox = () => {
    setStartTime(videoRef.current?.currentTime ?? 0)
  }

  const video = (
    <video
      ref={videoRef}
      src={resolvedSrc}
      autoPlay
      loop
      muted
      playsInline
      className={cn(
        'inline-block w-full max-w-[200px] rounded-lg border border-[var(--border-1)]',
        enableLightbox && 'transition-opacity group-hover:opacity-90'
      )}
    />
  )

  if (!enableLightbox) return video

  return (
    <Lightbox src={resolvedSrc} alt={alt} type='video' startTime={startTime}>
      <button
        type='button'
        onClick={openLightbox}
        aria-label={`Open ${alt} in media viewer`}
        className='group inline-block cursor-pointer rounded p-0 text-left'
      >
        {video}
      </button>
    </Lightbox>
  )
}
