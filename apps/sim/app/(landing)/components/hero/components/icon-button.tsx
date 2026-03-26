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
          ? 'border-[#454545] shadow-subtle'
          : 'border-transparent hover:border-[#454545] hover:shadow-subtle'
      }`}
      style={style}
    >
      {children}
    </button>
  )
}
