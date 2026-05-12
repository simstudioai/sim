'use client'

import { useRef, useState } from 'react'
import { cn, getAssetUrl } from '@/lib/utils'
import { Lightbox } from './lightbox'

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
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)

  const openLightbox = () => setIsLightboxOpen(true)

  const image = (
    <img
      src={src}
      alt={alt}
      className={cn(
        'inline-block w-full max-w-[200px] rounded border border-neutral-200 dark:border-neutral-700',
        enableLightbox && 'transition-opacity group-hover:opacity-90'
      )}
    />
  )

  return (
    <>
      {enableLightbox ? (
        <button
          type='button'
          onClick={openLightbox}
          aria-label={`Open ${alt} in media viewer`}
          className='group inline-block cursor-pointer rounded p-0 text-left'
        >
          {image}
        </button>
      ) : (
        image
      )}
      {enableLightbox && (
        <Lightbox
          isOpen={isLightboxOpen}
          onClose={() => setIsLightboxOpen(false)}
          src={src}
          alt={alt}
          type='image'
        />
      )}
    </>
  )
}

export function ActionVideo({ src, alt, enableLightbox = true }: ActionVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const startTimeRef = useRef(0)
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)
  const resolvedSrc = getAssetUrl(src)

  const openLightbox = () => {
    startTimeRef.current = videoRef.current?.currentTime ?? 0
    setIsLightboxOpen(true)
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
        'inline-block w-full max-w-[200px] rounded border border-neutral-200 dark:border-neutral-700',
        enableLightbox && 'transition-opacity group-hover:opacity-90'
      )}
    />
  )

  return (
    <>
      {enableLightbox ? (
        <button
          type='button'
          onClick={openLightbox}
          aria-label={`Open ${alt} in media viewer`}
          className='group inline-block cursor-pointer rounded p-0 text-left'
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
          alt={alt}
          type='video'
          startTime={startTimeRef.current}
        />
      )}
    </>
  )
}
