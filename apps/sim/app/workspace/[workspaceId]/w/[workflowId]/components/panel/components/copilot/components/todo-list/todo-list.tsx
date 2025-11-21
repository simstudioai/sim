'use client'

import { memo, useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/utils'

/**
 * Represents a single todo item
 */
export interface TodoItem {
  /** Unique identifier for the todo */
  id: string
  /** Todo content/description */
  content: string
  /** Whether the todo is completed */
  completed?: boolean
  /** Whether the todo is currently being executed */
  executing?: boolean
}

/**
 * Props for the TodoList component
 */
interface TodoListProps {
  /** Array of todo items to display */
  todos: TodoItem[]
  /** Callback when close button is clicked */
  onClose?: () => void
  /** Whether the list should be collapsed */
  collapsed?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Todo list component for displaying agent plan tasks
 * Shows progress bar and allows collapsing/expanding
 *
 * @param props - Component props
 * @returns Todo list UI with progress indicator
 */
export const TodoList = memo(function TodoList({
  todos,
  onClose,
  collapsed = false,
  className,
}: TodoListProps) {
  const [isCollapsed, setIsCollapsed] = useState(collapsed)

  /**
   * Sync collapsed prop with internal state
   */
  useEffect(() => {
    setIsCollapsed(collapsed)
  }, [collapsed])

  if (!todos || todos.length === 0) {
    return null
  }

  const completedCount = todos.filter((todo) => todo.completed).length
  const totalCount = todos.length
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  return (
    <div
      className={cn(
        'w-full rounded-t-[4px] rounded-b-none border-[var(--surface-11)] border-x border-t bg-[var(--surface-6)] dark:border-[var(--surface-11)] dark:bg-[var(--surface-9)]',
        className
      )}
    >
      {/* Header - always visible */}
      <div className='flex items-center justify-between px-[5.5px] py-[5px]'>
        <div className='flex items-center gap-[8px]'>
          <Button
            variant='ghost'
            onClick={() => setIsCollapsed(!isCollapsed)}
            className='!h-[14px] !w-[14px] !p-0'
          >
            {isCollapsed ? (
              <ChevronRight className='h-[14px] w-[14px]' />
            ) : (
              <ChevronDown className='h-[14px] w-[14px]' />
            )}
          </Button>
          <span className='font-medium text-[var(--text-primary)] text-xs dark:text-[var(--text-primary)]'>
            Todo:
          </span>
          <span className='font-medium text-[var(--text-primary)] text-xs dark:text-[var(--text-primary)]'>
            {completedCount}/{totalCount}
          </span>
        </div>

        <div className='flex flex-1 items-center gap-[8px] pl-[10px]'>
          {/* Progress bar */}
          <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-11)] dark:bg-[var(--surface-11)]'>
            <div
              className='h-full bg-[var(--brand-400)] transition-all duration-300 ease-out dark:bg-[var(--brand-400)]'
              style={{ width: `${progress}%` }}
            />
          </div>

          {onClose && (
            <Button
              variant='ghost'
              onClick={onClose}
              className='!h-[14px] !w-[14px] !p-0'
              aria-label='Close todo list'
            >
              <X className='h-[14px] w-[14px]' />
            </Button>
          )}
        </div>
      </div>

      {/* Todo items - only show when not collapsed */}
      {!isCollapsed && (
        <div className='max-h-48 overflow-y-auto'>
          {todos.map((todo, index) => (
            <div
              key={todo.id}
              className={cn(
                'flex items-start gap-2 px-3 py-1.5 transition-colors hover:bg-[var(--surface-9)]/50 dark:hover:bg-[var(--surface-11)]/50',
                index !== todos.length - 1 &&
                  'border-[var(--surface-11)] border-b dark:border-[var(--surface-11)]'
              )}
            >
              {todo.executing ? (
                <div className='mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                  <Loader2 className='h-3 w-3 animate-spin text-[var(--text-primary)] dark:text-[var(--text-primary)]' />
                </div>
              ) : (
                <div
                  className={cn(
                    'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-all',
                    todo.completed
                      ? 'border-[var(--brand-400)] bg-[var(--brand-400)] dark:border-[var(--brand-400)] dark:bg-[var(--brand-400)]'
                      : 'border-[#707070] dark:border-[#707070]'
                  )}
                >
                  {todo.completed ? <Check className='h-3 w-3 text-white' strokeWidth={3} /> : null}
                </div>
              )}

              <span
                className={cn(
                  'flex-1 font-base text-[12px] leading-relaxed',
                  todo.completed
                    ? 'text-[var(--text-muted)] line-through dark:text-[var(--text-muted)]'
                    : 'text-[var(--white)] dark:text-[var(--white)]'
                )}
              >
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
