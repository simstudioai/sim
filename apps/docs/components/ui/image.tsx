'use client'

import { Lightbox } from '@sim/emcn'
import NextImage, { type ImageProps as NextImageProps } from 'next/image'
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
  const lightboxSrc = typeof src === 'string' ? src : 'default' in src ? src.default.src : src.src

  const image = (
    <NextImage
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--border)] object-cover',
        enableLightbox && 'cursor-pointer transition-opacity group-hover:opacity-95',
        className
      )}
      alt={alt}
      src={src}
      {...props}
    />
  )

  if (!enableLightbox) return image

  return (
    <Lightbox src={lightboxSrc} alt={alt}>
      <button
        type='button'
        aria-label={`Open ${alt || 'image'} in media viewer`}
        className='group contents'
      >
        {image}
      </button>
    </Lightbox>
  )
}
