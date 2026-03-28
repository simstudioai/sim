'use client'

import { useState } from 'react'
import NextImage from 'next/image'
import { cn } from '@/lib/core/utils/cn'
import { Lightbox } from '@/app/(landing)/blog/components/lightbox'

interface BlogImageProps {
  src: string
  alt?: string
  width?: number
  height?: number
  className?: string
}

export function BlogImage({ src, alt = '', width = 800, height = 450, className }: BlogImageProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)

  return (
    <>
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
        onClick={() => setIsLightboxOpen(true)}
      />
      <Lightbox
        isOpen={isLightboxOpen}
        onClose={() => setIsLightboxOpen(false)}
        src={src}
        alt={alt}
      />
    </>
  )
}
