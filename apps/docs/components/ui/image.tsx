'use client'

import { useState } from 'react'
import NextImage, { type ImageProps as NextImageProps } from 'next/image'
import { Lightbox } from '@/components/ui/lightbox'
import { cn } from '@/lib/utils'

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

  const openLightbox = () => setIsLightboxOpen(true)

  const image = (
    <NextImage
      className={cn(
        'overflow-hidden rounded-xl border border-border object-cover',
        enableLightbox && 'cursor-pointer transition-opacity group-hover:opacity-95',
        className
      )}
      alt={alt}
      src={src}
      {...props}
    />
  )

  return (
    <>
      {enableLightbox ? (
        <button
          type='button'
          onClick={openLightbox}
          aria-label={`Open ${alt} in media viewer`}
          className='group contents'
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
          src={typeof src === 'string' ? src : String(src)}
          alt={alt}
          type='image'
        />
      )}
    </>
  )
}
