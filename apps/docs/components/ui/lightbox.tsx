'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { getAssetUrl } from '@/lib/utils'

interface LightboxProps {
  isOpen: boolean
  onClose: () => void
  src: string
  alt: string
  type: 'image' | 'video'
  startTime?: number
}

export function Lightbox({ isOpen, onClose, src, alt, type, startTime }: LightboxProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

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

  useLayoutEffect(() => {
    if (isOpen && type === 'video' && videoRef.current && startTime != null && startTime > 0) {
      videoRef.current.currentTime = startTime
    }
  }, [isOpen, startTime, type])

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-12 backdrop-blur-sm'
      role='dialog'
      aria-modal='true'
      aria-label='Media viewer'
    >
      <div className='relative max-h-full max-w-full overflow-hidden rounded-xl'>
        {type === 'image' ? (
          <img
            src={src}
            alt={alt}
            className='max-h-[75vh] max-w-[75vw] cursor-pointer rounded-xl object-contain'
            loading='lazy'
            onClick={onClose}
          />
        ) : (
          <video
            ref={videoRef}
            src={getAssetUrl(src)}
            autoPlay
            loop
            muted
            playsInline
            className='max-h-[75vh] max-w-[75vw] cursor-pointer rounded-xl outline-none focus:outline-none'
            onClick={onClose}
          />
        )}
      </div>
    </div>
  )
}
