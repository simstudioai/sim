'use client'

import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from '@sim/emcn/icons'
import NextImage from 'next/image'
import { docsControlClass } from '@/components/docs/primitives'
import { ScreenshotFrame } from '@/components/ui/screenshot-frame'

interface MediaViewerProps {
  children: ReactNode
  src: string
  backgroundSrc: string
  alt: string
  caption?: string
}

/** The original image remains available at full size in a keyboard-accessible dialog. */
export function MediaViewer({ children, src, backgroundSrc, alt, caption }: MediaViewerProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type='button'
          className='block w-full cursor-zoom-in rounded-lg text-left focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-4'
          aria-label={`Open ${alt || 'image'} in media viewer`}
        >
          {children}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className='fixed inset-0 z-50 bg-black/50 backdrop-blur-sm' />
        <Dialog.Content className='docs-portal fixed inset-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-[var(--docs-border)] bg-[var(--docs-overlay)] p-4 shadow-[var(--docs-shadow)] backdrop-blur-[20px] sm:inset-8'>
          <div className='flex shrink-0 items-center justify-between gap-4 pb-3'>
            <Dialog.Title className='text-docs-table'>{alt || 'Image'}</Dialog.Title>
            <Dialog.Close className={docsControlClass} aria-label='Close media viewer'>
              <X className='size-4' />
            </Dialog.Close>
          </div>
          <Dialog.Description className='sr-only'>
            {caption || 'Full-size documentation image. Press Escape to close.'}
          </Dialog.Description>
          <ScreenshotFrame variant='viewer' backgroundSrc={backgroundSrc} sizes='100vw' eager>
            <NextImage
              src={src}
              alt={alt}
              fill
              unoptimized
              sizes='100vw'
              className='object-contain'
            />
          </ScreenshotFrame>
          {caption && <p className='pt-3 text-[var(--docs-muted)] text-docs-caption'>{caption}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
