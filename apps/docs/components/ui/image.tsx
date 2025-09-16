'use client'

import { useState } from 'react'
import NextImage, { type ImageProps as NextImageProps } from 'next/image'
import { cn } from '@/lib/utils'
import { Lightbox } from './lightbox'

interface ImageProps extends Omit<NextImageProps, 'className'> {
  className?: string
  enableLightbox?: boolean
}

export function Image({
  className = 'w-full',
  enableLightbox = true,
  alt = '',
  src,
  ...props
}: ImageProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)

  const handleImageClick = () => {
    if (enableLightbox) {
      setIsLightboxOpen(true)
    }
  }

  return (
    <>
      <NextImage
        className={cn(
          'overflow-hidden rounded-xl border border-border object-cover shadow-sm',
          enableLightbox && 'cursor-pointer transition-opacity hover:opacity-90',
          className
        )}
        alt={alt}
        src={src}
        onClick={handleImageClick}
        {...props}
      />

      {enableLightbox && (
        <Lightbox
          isOpen={isLightboxOpen}
          onClose={() => setIsLightboxOpen(false)}
          src={typeof src === 'string' ? src : String(src)}
          alt={alt}
          type='image'
        />
      )}
    </>
  )
}
