'use client'

import { useState } from 'react'
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

  const handleClick = () => {
    if (enableLightbox) {
      setIsLightboxOpen(true)
    }
  }

  return (
    <>
      <img
        src={src}
        alt={alt}
        onClick={handleClick}
        className={cn(
          'inline-block w-full max-w-[200px] rounded border border-neutral-200 dark:border-neutral-700',
          enableLightbox && 'cursor-pointer transition-opacity hover:opacity-90'
        )}
      />
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
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)
  const resolvedSrc = getAssetUrl(src)

  const handleClick = () => {
    if (enableLightbox) {
      setIsLightboxOpen(true)
    }
  }

  return (
    <>
      <video
        src={resolvedSrc}
        autoPlay
        loop
        muted
        playsInline
        onClick={handleClick}
        className={cn(
          'inline-block w-full max-w-[200px] rounded border border-neutral-200 dark:border-neutral-700',
          enableLightbox && 'cursor-pointer transition-opacity hover:opacity-90'
        )}
      />
      {enableLightbox && (
        <Lightbox
          isOpen={isLightboxOpen}
          onClose={() => setIsLightboxOpen(false)}
          src={src}
          alt={alt}
          type='video'
        />
      )}
    </>
  )
}
