'use client'

import { cn, Lightbox } from '@sim/emcn'
import NextImage from 'next/image'

interface ContentImageProps {
  src: string
  alt?: string
  width?: number
  height?: number
  className?: string
}

/**
 * Click-to-zoom image renderer used by MDX content (blog and library posts
 * both compile through the same `mdxComponents` map in `@/lib/content/mdx`).
 */
export function ContentImage({
  src,
  alt = '',
  width = 800,
  height = 450,
  className,
}: ContentImageProps) {
  return (
    <Lightbox src={src} alt={alt}>
      <button
        type='button'
        aria-label={`Open ${alt || 'image'} in media viewer`}
        className='block w-full'
      >
        <NextImage
          src={src}
          alt={alt}
          width={width}
          height={height}
          className={cn(
            'h-auto w-full cursor-pointer rounded-lg transition-opacity hover:opacity-95',
            className
          )}
          sizes='(max-width: 768px) 100vw, 800px'
          loading='lazy'
          unoptimized
        />
      </button>
    </Lightbox>
  )
}
