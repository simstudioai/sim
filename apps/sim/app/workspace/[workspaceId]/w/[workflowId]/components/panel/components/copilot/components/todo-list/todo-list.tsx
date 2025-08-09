'use client'

import { memo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ListTodo, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TodoItem {
  id: string
  content: string
  completed?: boolean
  executing?: boolean
}

interface TodoListProps {
  todos: TodoItem[]
  onClose?: () => void
  className?: string
}

export const TodoList = memo(function TodoList({
  todos,
  onClose,
  className,
}: TodoListProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  
  if (!todos || todos.length === 0) {
    return null
  }

  const completedCount = todos.filter(todo => todo.completed).length
  const totalCount = todos.length
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  return (
    <div
      className={cn(
        'border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900',
        className
      )}
    >
      {/* Header */}
      <div className='flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800'>
        <div className='flex items-center gap-2'>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className='p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors'
          >
            {isCollapsed ? (
              <ChevronRight className='h-4 w-4 text-gray-500' />
            ) : (
              <ChevronDown className='h-4 w-4 text-gray-500' />
            )}
          </button>
          <ListTodo className='h-4 w-4 text-gray-500' />
          <span className='text-xs font-medium text-gray-700 dark:text-gray-300'>
            Todo List
          </span>
          <span className='text-xs text-gray-500 dark:text-gray-400'>
            {completedCount}/{totalCount}
          </span>
        </div>
        
        <div className='flex items-center gap-2'>
          {/* Progress bar */}
          <div className='w-24 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden'>
            <div
              className='h-full bg-blue-500 transition-all duration-300 ease-out'
              style={{ width: `${progress}%` }}
            />
          </div>
          
          {onClose && (
            <button
              onClick={onClose}
              className='p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors'
              aria-label='Close todo list'
            >
              <X className='h-3.5 w-3.5 text-gray-400' />
            </button>
          )}
        </div>
      </div>

      {/* Todo items */}
      {!isCollapsed && (
        <div className='max-h-48 overflow-y-auto'>
          {todos.map((todo, index) => (
            <div
              key={todo.id}
              className={cn(
                'flex items-start gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors',
                index !== todos.length - 1 && 'border-b border-gray-50 dark:border-gray-800'
              )}
            >
              <div
                className={cn(
                  'mt-0.5 flex-shrink-0 w-4 h-4 rounded border transition-all flex items-center justify-center',
                  todo.executing
                    ? 'border-blue-400 dark:border-blue-500'
                    : todo.completed
                    ? 'bg-blue-500 border-blue-500'
                    : 'border-gray-300 dark:border-gray-600'
                )}
              >
                {todo.executing ? (
                  <Loader2 className='h-3 w-3 text-blue-500 animate-spin' />
                ) : todo.completed ? (
                  <Check className='h-3 w-3 text-white' strokeWidth={3} />
                ) : null}
              </div>
              
              <span
                className={cn(
                  'text-xs leading-relaxed flex-1',
                  todo.completed
                    ? 'text-gray-400 line-through'
                    : 'text-gray-700 dark:text-gray-300'
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