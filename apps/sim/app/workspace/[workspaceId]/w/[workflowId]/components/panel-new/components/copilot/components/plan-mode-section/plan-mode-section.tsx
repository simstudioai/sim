'use client'

import React, { useCallback, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { GripHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Props for the PlanModeSection component
 */
interface PlanModeSectionProps {
  /** Markdown content to display */
  content: string
  /** Optional class name for additional styling */
  className?: string
  /** Initial height of the section in pixels */
  initialHeight?: number
  /** Minimum height in pixels */
  minHeight?: number
  /** Maximum height in pixels */
  maxHeight?: number
}

/**
 * Plan Mode Section component
 * Displays markdown content in a separate section at the top of the copilot panel
 * Follows emcn design principles with consistent spacing, typography, and color scheme
 * Features: pinned position, resizable height, internal scrolling
 *
 * @param props - Component props
 * @returns Rendered plan mode section with markdown content
 */
export function PlanModeSection({
  content,
  className,
  initialHeight = 180,
  minHeight = 80,
  maxHeight = 600,
}: PlanModeSectionProps) {
  const [height, setHeight] = useState(initialHeight)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartRef = useRef({ y: 0, startHeight: 0 })

  /**
   * Handles the start of a resize operation
   */
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizeStartRef.current = {
      y: e.clientY,
      startHeight: height,
    }
  }, [height])

  /**
   * Handles mouse movement during resize
   */
  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return

    const deltaY = e.clientY - resizeStartRef.current.y
    const newHeight = Math.max(
      minHeight,
      Math.min(maxHeight, resizeStartRef.current.startHeight + deltaY)
    )
    setHeight(newHeight)
  }, [isResizing, minHeight, maxHeight])

  /**
   * Handles the end of a resize operation
   */
  const handleResizeEnd = useCallback(() => {
    setIsResizing(false)
  }, [])

  /**
   * Set up and clean up resize event listeners
   */
  React.useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove)
      document.addEventListener('mouseup', handleResizeEnd)
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
      
      return () => {
        document.removeEventListener('mousemove', handleResizeMove)
        document.removeEventListener('mouseup', handleResizeEnd)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizing, handleResizeMove, handleResizeEnd])
  const markdownComponents = useMemo(
    () => ({
      // Paragraph
      p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => (
        <p className='mb-2 font-season text-[13px] font-[470] leading-[1.4rem] text-[var(--text-secondary)] last:mb-0 dark:text-[var(--text-secondary)]'>
          {children}
        </p>
      ),

      // Headings
      h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h1 className='mb-3 font-season text-[16px] font-[500] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
          {children}
        </h1>
      ),
      h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h2 className='mb-2.5 font-season text-[15px] font-[500] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
          {children}
        </h2>
      ),
      h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h3 className='mb-2 font-season text-[14px] font-[500] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
          {children}
        </h3>
      ),
      h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h4 className='mb-1.5 font-season text-[13px] font-[500] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
          {children}
        </h4>
      ),

      // Lists
      ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
        <ul className='my-2 space-y-1 pl-5 font-season text-[13px] font-[470] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] [list-style-type:disc]'>
          {children}
        </ul>
      ),
      ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
        <ol className='my-2 space-y-1 pl-5 font-season text-[13px] font-[470] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] [list-style-type:decimal]'>
          {children}
        </ol>
      ),
      li: ({ children }: React.HTMLAttributes<HTMLLIElement>) => (
        <li className='text-[13px] leading-[1.4rem]'>{children}</li>
      ),

      // Code blocks
      pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => (
        <pre className='my-2 overflow-x-auto rounded-[4px] bg-[var(--surface-5)] p-3 font-mono text-[12px] dark:bg-[var(--surface-5)]'>
          {children}
        </pre>
      ),

      // Inline code
      code: ({
        inline,
        children,
        ...props
      }: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) => {
        if (inline) {
          return (
            <code
              className='rounded-[3px] bg-[var(--surface-5)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-primary)] dark:bg-[var(--surface-5)] dark:text-[var(--text-primary)]'
              {...props}
            >
              {children}
            </code>
          )
        }
        return (
          <code
            className='font-mono text-[12px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'
            {...props}
          >
            {children}
          </code>
        )
      },

      // Blockquote
      blockquote: ({ children }: React.HTMLAttributes<HTMLQuoteElement>) => (
        <blockquote className='my-2 border-l-2 border-[var(--border-strong)] pl-4 font-season text-[13px] font-[470] italic text-[var(--text-secondary)] dark:border-[var(--border-strong)] dark:text-[var(--text-secondary)]'>
          {children}
        </blockquote>
      ),

      // Horizontal rule
      hr: () => (
        <hr className='my-3 border-[var(--border-strong)] dark:border-[var(--border-strong)]' />
      ),

      // Links
      a: ({ children, href }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a
          href={href}
          className='text-[var(--brand-400)] underline decoration-[var(--brand-400)]/30 underline-offset-2 transition-colors hover:decoration-[var(--brand-400)] dark:text-[var(--brand-400)]'
          target='_blank'
          rel='noopener noreferrer'
        >
          {children}
        </a>
      ),

      // Strong/Bold
      strong: ({ children }: React.HTMLAttributes<HTMLElement>) => (
        <strong className='font-[500] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
          {children}
        </strong>
      ),

      // Emphasis/Italic
      em: ({ children }: React.HTMLAttributes<HTMLElement>) => (
        <em className='italic text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
          {children}
        </em>
      ),
    }),
    []
  )

  if (!content || !content.trim()) {
    return null
  }

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-[4px] bg-[var(--surface-5)] dark:bg-[var(--surface-5)]',
        className
      )}
      style={{ height: `${height}px` }}
    >
      {/* Scrollable content area */}
      <div className='flex-1 overflow-y-auto overflow-x-hidden px-[12px] py-[10px]'>
        <div className='max-w-full break-words'>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {content.trim()}
          </ReactMarkdown>
        </div>
      </div>

      {/* Resize handle */}
      <div
        className={cn(
          'group flex h-[20px] w-full cursor-ns-resize items-center justify-center border-t border-[var(--border-strong)] transition-colors hover:bg-[var(--surface-9)] dark:border-[var(--border-strong)] dark:hover:bg-[var(--surface-9)]',
          isResizing && 'bg-[var(--surface-9)] dark:bg-[var(--surface-9)]'
        )}
        onMouseDown={handleResizeStart}
        role='separator'
        aria-orientation='horizontal'
        aria-label='Resize plan section'
      >
        <GripHorizontal className='h-3 w-3 text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text-primary)] dark:text-[var(--text-secondary)] dark:group-hover:text-[var(--text-primary)]' />
      </div>
    </div>
  )
}

