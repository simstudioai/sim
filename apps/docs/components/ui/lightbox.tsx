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
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm'
      role='dialog'
      aria-modal='true'
      aria-label='Media viewer'
    >
      <div className='relative flex max-h-[90vh] max-w-[90vw] items-center justify-center'>
        {type === 'image' ? (
          <img
            src={src}
            alt={alt}
            className='max-h-full max-w-full rounded-xl object-contain shadow-2xl'
            loading='lazy'
          />
        ) : (
          <video
            src={getVideoUrl(src)}
            autoPlay
            loop
            muted
            playsInline
            className='max-h-full max-w-full rounded-xl shadow-2xl outline-none focus:outline-none'
          />
        )}
      </div>
    </div>
  )
}
