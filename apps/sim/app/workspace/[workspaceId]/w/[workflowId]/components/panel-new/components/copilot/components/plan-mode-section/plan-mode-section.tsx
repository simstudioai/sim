/**
 * Plan Mode Section component with resizable markdown content display.
 * Displays markdown content in a separate section at the top of the copilot panel.
 * Follows emcn design principles with consistent spacing, typography, and color scheme.
 *
 * @example
 * ```tsx
 * import { PlanModeSection } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components'
 *
 * function CopilotPanel() {
 *   const plan = "# My Plan\n\nThis is a plan description..."
 *
 *   return (
 *     <PlanModeSection
 *       content={plan}
 *       initialHeight={200}
 *       minHeight={100}
 *       maxHeight={600}
 *     />
 *   )
 * }
 * ```
 */

'use client'

import * as React from 'react'
import { GripHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import CopilotMarkdownRenderer from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components/copilot-message/components/markdown-renderer'

/**
 * Shared border and background styles
 */
const SURFACE_5 = 'bg-[var(--surface-5)] dark:bg-[var(--surface-5)]'
const SURFACE_9 = 'bg-[var(--surface-9)] dark:bg-[var(--surface-9)]'
const BORDER_STRONG = 'border-[var(--border-strong)] dark:border-[var(--border-strong)]'

export interface PlanModeSectionProps {
  /**
   * Markdown content to display
   */
  content: string
  /**
   * Optional class name for additional styling
   */
  className?: string
  /**
   * Initial height of the section in pixels
   * @default 180
   */
  initialHeight?: number
  /**
   * Minimum height in pixels
   * @default 80
   */
  minHeight?: number
  /**
   * Maximum height in pixels
   * @default 600
   */
  maxHeight?: number
}

/**
 * Plan Mode Section component for displaying markdown content with resizable height.
 * Features: pinned position, resizable height with drag handle, internal scrolling.
 */
const PlanModeSection: React.FC<PlanModeSectionProps> = ({
  content,
  className,
  initialHeight = 180,
  minHeight = 80,
  maxHeight = 600,
}) => {
  const [height, setHeight] = React.useState(initialHeight)
  const [isResizing, setIsResizing] = React.useState(false)
  const resizeStartRef = React.useRef({ y: 0, startHeight: 0 })

  const handleResizeStart = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
      resizeStartRef.current = {
        y: e.clientY,
        startHeight: height,
      }
    },
    [height]
  )

  const handleResizeMove = React.useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return

      const deltaY = e.clientY - resizeStartRef.current.y
      const newHeight = Math.max(
        minHeight,
        Math.min(maxHeight, resizeStartRef.current.startHeight + deltaY)
      )
      setHeight(newHeight)
    },
    [isResizing, minHeight, maxHeight]
  )

  const handleResizeEnd = React.useCallback(() => {
    setIsResizing(false)
  }, [])

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

  if (!content || !content.trim()) {
    return null
  }

  return (
    <div
      className={cn('relative flex flex-col rounded-[4px]', SURFACE_5, className)}
      style={{ height: `${height}px` }}
    >
      <div className='flex-1 overflow-y-auto overflow-x-hidden px-[12px] py-[10px]'>
        <CopilotMarkdownRenderer content={content.trim()} />
      </div>

      <div
        className={cn(
          'group flex h-[20px] w-full cursor-ns-resize items-center justify-center border-t',
          BORDER_STRONG,
          'transition-colors hover:bg-[var(--surface-9)] dark:hover:bg-[var(--surface-9)]',
          isResizing && SURFACE_9
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

PlanModeSection.displayName = 'PlanModeSection'

export { PlanModeSection }
