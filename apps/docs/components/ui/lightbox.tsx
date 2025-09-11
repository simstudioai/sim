'use client'

import { useEffect, useRef } from 'react'
import { getVideoUrl } from '@/lib/utils'

interface LightboxProps {
  isOpen: boolean
  onClose: () => void
  src: string
  alt: string
  type: 'image' | 'video'
}

export function Lightbox({ isOpen, onClose, src, alt, type }: LightboxProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (overlayRef.current && event.target === overlayRef.current) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.addEventListener('click', handleClickOutside)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('click', handleClickOutside)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-12 backdrop-blur-sm'
      role='dialog'
      aria-modal='true'
      aria-label='Media viewer'
    >
      <div className='relative max-h-full max-w-full overflow-hidden rounded-xl shadow-2xl'>
        {type === 'image' ? (
          <img
            src={src}
            alt={alt}
            className='max-h-[calc(100vh-6rem)] max-w-[calc(100vw-6rem)] rounded-xl object-contain'
            loading='lazy'
          />
        ) : (
          <video
            src={getVideoUrl(src)}
            autoPlay
            loop
            muted
            playsInline
            className='max-h-[calc(100vh-6rem)] max-w-[calc(100vw-6rem)] rounded-xl outline-none focus:outline-none'
          />
        )}
      </div>
    </div>
  )
}
