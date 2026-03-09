'use client'

import type React from 'react'
import { motion } from 'framer-motion'

interface IconButtonProps {
  children: React.ReactNode
  onClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  style?: React.CSSProperties
  'aria-label': string
  isActive?: boolean
}

export function IconButton({
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
  style,
  'aria-label': ariaLabel,
  isActive = false,
}: IconButtonProps) {
  return (
    <button
      type='button'
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className='relative flex items-center justify-center rounded-xl p-2 outline-none'
      style={style}
    >
      {isActive && (
        <motion.div
          layoutId='icon-highlight-pill'
          className='absolute inset-0 rounded-xl border border-[#E5E5E5] shadow-[0_2px_4px_0_rgba(0,0,0,0.08)]'
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}
      <span className='relative z-[1]'>{children}</span>
    </button>
  )
}
