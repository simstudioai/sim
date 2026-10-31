'use client'

import type { ReactNode } from 'react'
import { Lightbox } from '@/components/ui/lightbox'
import { ScreenshotFrame } from '@/components/ui/screenshot-frame'

interface MediaViewerProps {
  children: ReactNode
  expandedImage: ReactNode
  backgroundSrc: string
  alt: string
  caption?: string
}

/** The original image remains available at full size in a keyboard-accessible dialog. */
export function MediaViewer({
  children,
  expandedImage,
  backgroundSrc,
  alt,
  caption,
}: MediaViewerProps) {
  return (
    <Lightbox
      title={alt || 'Image'}
      description={caption || 'Full-size documentation image. Press Escape to close.'}
      trigger={
        <button
          type='button'
          className='block w-full cursor-zoom-in rounded-lg text-left focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-4'
          aria-label={`Open ${alt || 'image'} in media viewer`}
        >
          {children}
        </button>
      }
    >
      <ScreenshotFrame variant='viewer' backgroundSrc={backgroundSrc} sizes='100vw' eager>
        {expandedImage}
      </ScreenshotFrame>
      {caption && <p className='pt-3 text-[var(--docs-muted)] text-docs-caption'>{caption}</p>}
    </Lightbox>
  )
}
