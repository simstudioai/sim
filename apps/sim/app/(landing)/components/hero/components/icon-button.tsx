'use client'

import type React from 'react'

interface IconButtonProps {
  children: React.ReactNode
  onClick?: () => void
  onMouseEnter?: () => void
  style?: React.CSSProperties
  'aria-label': string
  isAutoHovered?: boolean
}

export function IconButton({
  children,
  onClick,
  onMouseEnter,
  style,
  'aria-label': ariaLabel,
  isAutoHovered = false,
}: IconButtonProps) {
  return (
    <button
      type='button'
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`flex items-center justify-center rounded-xl border p-2 outline-none transition-all duration-300 ${
        isAutoHovered
          ? 'border-[#E5E5E5] shadow-[0_2px_4px_0_rgba(0,0,0,0.08)]'
          : 'border-transparent hover:border-[#E5E5E5] hover:shadow-[0_2px_4px_0_rgba(0,0,0,0.08)]'
      }`}
      style={style}
    >
      {children}
    </button>
  )
}
