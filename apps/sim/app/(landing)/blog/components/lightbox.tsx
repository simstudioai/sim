'use client'

import { useEffect, useEffectEvent, useRef } from 'react'

interface LightboxProps {
  isOpen: boolean
  onClose: () => void
  src: string
  alt: string
}

export function Lightbox({ isOpen, onClose, src, alt }: LightboxProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  const onCloseEvent = useEffectEvent(onClose)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseEvent()
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (overlayRef.current && event.target === overlayRef.current) {
        onCloseEvent()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('click', handleClickOutside)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('click', handleClickOutside)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-12 backdrop-blur-sm'
      role='dialog'
      aria-modal='true'
      aria-label='Image viewer'
    >
      <div className='relative max-h-full max-w-full overflow-hidden rounded-xl shadow-2xl'>
        <button type='button' className='block cursor-pointer rounded-xl' onClick={onClose}>
          <img
            src={src}
            alt={alt}
            className='max-h-[75vh] max-w-[75vw] rounded-xl object-contain'
            loading='lazy'
          />
        </button>
      </div>
    </div>
  )
}
