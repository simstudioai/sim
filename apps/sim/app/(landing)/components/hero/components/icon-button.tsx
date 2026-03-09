'use client'

import { forwardRef } from 'react'
import type React from 'react'

interface IconButtonProps {
  children: React.ReactNode
  onClick?: () => void
  onMouseEnter?: () => void
  style?: React.CSSProperties
  'aria-label': string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, onClick, onMouseEnter, style, 'aria-label': ariaLabel },
  ref
) {
  return (
    <button
      ref={ref}
      type='button'
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className='flex items-center justify-center rounded-xl border border-transparent p-2 outline-none'
      style={style}
    >
      {children}
    </button>
  )
})
