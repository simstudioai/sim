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
 * Styled to match the application's subflow containers
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
        borderRadius: '8px',
        background: 'rgba(59, 130, 246, 0.08)',
        position: 'relative',
        ...style,
      }}
    >
      {/* Custom dashed border with SVG - 8px border radius to match blocks */}
      <svg
        className='pointer-events-none absolute inset-0 h-full w-full'
        style={{ borderRadius: '8px' }}
        preserveAspectRatio='none'
      >
        <path
          className='landing-loop-animated-dash'
          d='M 1190 527.5 
             L 8 527.5 
             A 7.5 7.5 0 0 1 0.5 520 
             L 0.5 8 
             A 7.5 7.5 0 0 1 8 0.5 
             L 1190 0.5 
             A 7.5 7.5 0 0 1 1197.5 8 
             L 1197.5 520 
             A 7.5 7.5 0 0 1 1190 527.5 Z'
          fill='none'
          stroke='#3B82F6'
          strokeWidth='1'
          strokeDasharray='8 8'
          strokeLinecap='round'
        />
      </svg>
      {children}
    </div>
  )
})
