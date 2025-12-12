'use client'

import { useState } from 'react'
import { getAssetUrl } from '@/lib/utils'
import { Lightbox } from './lightbox'

interface VideoProps {
  src: string
  className?: string
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  playsInline?: boolean
  enableLightbox?: boolean
}

export function Video({
  src,
  className = 'w-full rounded-xl border border-border shadow-sm overflow-hidden outline-none focus:outline-none',
  autoPlay = true,
  loop = true,
  muted = true,
  playsInline = true,
  enableLightbox = true,
}: VideoProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)

  const handleVideoClick = () => {
    if (enableLightbox) {
      setIsLightboxOpen(true)
    }
  }

  return (
    <>
      <video
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline={playsInline}
        className={`${className} ${enableLightbox ? 'cursor-pointer transition-opacity hover:opacity-90' : ''}`}
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
        />
      )}
    </>
  )
}
