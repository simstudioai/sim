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
        'w-full rounded-t-[4px] rounded-b-none border-[#3D3D3D] border-x border-t bg-[#282828] dark:border-[#3D3D3D] dark:bg-[#363636]',
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
          <span className='font-medium text-[#E6E6E6] text-xs dark:text-[#E6E6E6]'>Todo:</span>
          <span className='font-medium text-[#E6E6E6] text-xs dark:text-[#E6E6E6]'>
            {completedCount}/{totalCount}
          </span>
        </div>

        <div className='flex flex-1 items-center gap-[8px] pl-[10px]'>
          {/* Progress bar */}
          <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-[#3D3D3D] dark:bg-[#3D3D3D]'>
            <div
              className='h-full bg-[#8E4CFB] transition-all duration-300 ease-out dark:bg-[#8E4CFB]'
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
                'flex items-start gap-2 px-3 py-1.5 transition-colors hover:bg-[#363636]/50 dark:hover:bg-[#3D3D3D]/50',
                index !== todos.length - 1 && 'border-[#3D3D3D] border-b dark:border-[#3D3D3D]'
              )}
            >
              {todo.executing ? (
                <div className='mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                  <Loader2 className='h-3 w-3 animate-spin text-[#E6E6E6] dark:text-[#E6E6E6]' />
                </div>
              ) : (
                <div
                  className={cn(
                    'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-all',
                    todo.completed
                      ? 'border-[#8E4CFB] bg-[#8E4CFB] dark:border-[#8E4CFB] dark:bg-[#8E4CFB]'
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
                    ? 'text-[#787878] line-through dark:text-[#787878]'
                    : 'text-[#FFFFFF] dark:text-[#FFFFFF]'
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
