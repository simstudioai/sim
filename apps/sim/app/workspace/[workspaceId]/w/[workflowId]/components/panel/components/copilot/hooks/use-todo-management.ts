'use client'

import { useEffect, useRef, useState } from 'react'

interface UseTodoManagementProps {
  isSendingMessage: boolean
  showPlanTodos: boolean
  planTodos: Array<{ id: string; content: string; completed?: boolean }>
  setPlanTodos: (todos: any[]) => void
}

/**
 * Custom hook to manage todo list visibility and state
 *
 * @param props - Todo management configuration
 * @returns Todo management utilities
 */
export function useTodoManagement(props: UseTodoManagementProps) {
  const { isSendingMessage, showPlanTodos, planTodos, setPlanTodos } = props

  const [todosCollapsed, setTodosCollapsed] = useState(false)
  const wasSendingRef = useRef(false)

  /**
   * Auto-collapse todos when stream completes. Do not prune items.
   */
  useEffect(() => {
    if (wasSendingRef.current && !isSendingMessage && showPlanTodos) {
      setTodosCollapsed(true)
    }
    wasSendingRef.current = isSendingMessage
  }, [isSendingMessage, showPlanTodos])

  /**
   * Reset collapsed state when todos first appear
   */
  useEffect(() => {
    if (showPlanTodos && planTodos.length > 0) {
      if (isSendingMessage) {
        setTodosCollapsed(false)
      }
    }
  }, [showPlanTodos, planTodos.length, isSendingMessage])

  return {
    todosCollapsed,
    setTodosCollapsed,
  }
}
