'use client'

import type React from 'react'

/**
 * Props for the IconButton component
 */
interface IconButtonProps {
  /** Content to display inside the button */
  children: React.ReactNode
  /** Handler for button click events */
  onClick?: () => void
  /** Handler for mouse enter events */
  onMouseEnter?: () => void
  /** Custom styles to apply to the button */
  style?: React.CSSProperties
  /** Accessible label for screen readers */
  'aria-label': string
  /** Whether the button should display auto-hover state */
  isAutoHovered?: boolean
  /** Whether the button is in clicked state (maintains hover appearance) */
  isClicked?: boolean
}

/**
 * Icon button component for service integrations
 * Supports auto-hover animation and click-to-stick hover state
 */
export function IconButton({
  children,
  onClick,
  onMouseEnter,
  style,
  'aria-label': ariaLabel,
  isAutoHovered = false,
  isClicked = false,
}: IconButtonProps) {
  return (
    <button
      type='button'
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`flex items-center justify-center rounded-xl border p-2 outline-none ${
        // When clicked, maintain hover state without animation
        isClicked
          ? 'border-[#E5E5E5] shadow-[0_2px_4px_0_rgba(0,0,0,0.08)]'
          : // Otherwise, handle auto-hover and regular hover states with animation
            `transition-all duration-300 ${
              isAutoHovered
                ? 'border-[#E5E5E5] shadow-[0_2px_4px_0_rgba(0,0,0,0.08)]'
                : 'border-transparent hover:border-[#E5E5E5] hover:shadow-[0_2px_4px_0_rgba(0,0,0,0.08)]'
            }`
      }`}
      style={style}
    >
      {children}
    </button>
  )
}
