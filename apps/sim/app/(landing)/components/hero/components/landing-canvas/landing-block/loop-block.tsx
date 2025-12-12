import React from 'react'

/**
 * Props for the LoopBlock component
 */
export interface LoopBlockProps {
  /** Child elements to render inside the loop block */
  children?: React.ReactNode
  /** Optional CSS class names */
  className?: string
  /** Optional inline styles */
  style?: React.CSSProperties
}

/**
 * Loop block container component that provides a styled container
 * for grouping related elements with a dashed border
 * @param props - Component properties including children and styling
 * @returns A styled loop container component
 */
export const LoopBlock = React.memo(function LoopBlock({
  children,
  className,
  style,
}: LoopBlockProps) {
  return (
    <div
      className={`flex flex-shrink-0 ${className ?? ''}`}
      style={{
        width: '1198px',
        height: '528px',
        borderRadius: '14px',
        background: 'rgba(59, 130, 246, 0.10)',
        position: 'relative',
        ...style,
      }}
    >
      {/* Custom dashed border with SVG */}
      <svg
        className='pointer-events-none absolute inset-0 h-full w-full'
        style={{ borderRadius: '14px' }}
        preserveAspectRatio='none'
      >
        <path
          className='landing-loop-animated-dash'
          d='M 1183.5 527.5 
             L 14 527.5 
             A 13.5 13.5 0 0 1 0.5 514 
             L 0.5 14 
             A 13.5 13.5 0 0 1 14 0.5 
             L 1183.5 0.5 
             A 13.5 13.5 0 0 1 1197 14 
             L 1197 514 
             A 13.5 13.5 0 0 1 1183.5 527.5 Z'
          fill='none'
          stroke='#3B82F6'
          strokeWidth='1'
          strokeDasharray='12 12'
          strokeLinecap='round'
        />
      </svg>
      {children}
    </div>
  )
})
