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
import { Check, GripHorizontal, Pencil, X } from 'lucide-react'
import { Button } from '@/components/emcn'
import { Trash } from '@/components/emcn/icons/trash'
import { Textarea } from '@/components/ui'
import { cn } from '@/lib/utils'
import CopilotMarkdownRenderer from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/markdown-renderer'

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
  /**
   * Callback function when clear button is clicked
   */
  onClear?: () => void
  /**
   * Callback function when save button is clicked
   * Receives the current content as parameter
   */
  onSave?: (content: string) => void
  /**
   * Callback when Build Plan button is clicked
   */
  onBuildPlan?: () => void
}

/**
 * Plan Mode Section component for displaying markdown content with resizable height.
 * Features: pinned position, resizable height with drag handle, internal scrolling.
 */
const PlanModeSection: React.FC<PlanModeSectionProps> = ({
  content,
  className,
  initialHeight,
  minHeight = 80,
  maxHeight = 600,
  onClear,
  onSave,
  onBuildPlan,
}) => {
  // Default to 75% of max height
  const defaultHeight = initialHeight ?? Math.floor(maxHeight * 0.75)
  const [height, setHeight] = React.useState(defaultHeight)
  const [isResizing, setIsResizing] = React.useState(false)
  const [isEditing, setIsEditing] = React.useState(false)
  const [editedContent, setEditedContent] = React.useState(content)
  const resizeStartRef = React.useRef({ y: 0, startHeight: 0 })
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Update edited content when content prop changes
  React.useEffect(() => {
    if (!isEditing) {
      setEditedContent(content)
    }
  }, [content, isEditing])

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

  const handleEdit = React.useCallback(() => {
    setIsEditing(true)
    setEditedContent(content)
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)
  }, [content])

  const handleSave = React.useCallback(() => {
    if (onSave && editedContent.trim() !== content.trim()) {
      onSave(editedContent.trim())
    }
    setIsEditing(false)
  }, [editedContent, content, onSave])

  const handleCancel = React.useCallback(() => {
    setEditedContent(content)
    setIsEditing(false)
  }, [content])

  if (!content || !content.trim()) {
    return null
  }

  return (
    <div
      className={cn('relative flex flex-col rounded-[4px]', SURFACE_5, className)}
      style={{ height: `${height}px` }}
    >
      {/* Header with build/edit/save/clear buttons */}
      <div className='flex flex-shrink-0 items-center justify-between border-[var(--border-strong)] border-b py-[6px] pr-[2px] pl-[12px] dark:border-[var(--border-strong)]'>
        <span className='font-[500] text-[11px] text-[var(--text-secondary)] uppercase tracking-wide dark:text-[var(--text-secondary)]'>
          Workflow Plan
        </span>
        <div className='ml-auto flex items-center gap-[4px]'>
          {isEditing ? (
            <>
              <Button
                variant='ghost'
                className='h-[18px] w-[18px] p-0 hover:text-[var(--text-primary)]'
                onClick={handleCancel}
                aria-label='Cancel editing'
              >
                <X className='h-[11px] w-[11px]' />
              </Button>
              <Button
                variant='ghost'
                className='h-[18px] w-[18px] p-0 hover:text-[var(--text-primary)]'
                onClick={handleSave}
                aria-label='Save changes'
              >
                <Check className='h-[12px] w-[12px]' />
              </Button>
            </>
          ) : (
            <>
              {onBuildPlan && (
                <Button
                  variant='default'
                  onClick={onBuildPlan}
                  className='h-[22px] px-[10px] text-[11px]'
                  title='Build workflow from plan'
                >
                  Build Plan
                </Button>
              )}
              {onSave && (
                <Button
                  variant='ghost'
                  className='h-[18px] w-[18px] p-0 hover:text-[var(--text-primary)]'
                  onClick={handleEdit}
                  aria-label='Edit workflow plan'
                >
                  <Pencil className='h-[10px] w-[10px]' />
                </Button>
              )}
              {onClear && (
                <Button
                  variant='ghost'
                  className='h-[18px] w-[18px] p-0 hover:text-[var(--text-primary)]'
                  onClick={onClear}
                  aria-label='Clear workflow plan'
                >
                  <Trash className='h-[11px] w-[11px]' />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Scrollable content area */}
      <div className='flex-1 overflow-y-auto overflow-x-hidden px-[12px] py-[10px]'>
        {isEditing ? (
          <Textarea
            ref={textareaRef}
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className='h-full min-h-full w-full resize-none border-0 bg-transparent p-0 font-[470] font-season text-[13px] text-[var(--text-primary)] leading-[1.4rem] outline-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-[var(--text-primary)]'
            placeholder='Enter your workflow plan...'
          />
        ) : (
          <CopilotMarkdownRenderer content={content.trim()} />
        )}
      </div>

      {/* Resize handle */}
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
