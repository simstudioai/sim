'use client'

import { useEffect, useRef, useState } from 'react'
import { Brain } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Timer update interval in milliseconds
 */
const TIMER_UPDATE_INTERVAL = 100

/**
 * Milliseconds threshold for displaying as seconds
 */
const SECONDS_THRESHOLD = 1000

/**
 * Props for the ThinkingBlock component
 */
interface ThinkingBlockProps {
  /** Content of the thinking block */
  content: string
  /** Whether the block is currently streaming */
  isStreaming?: boolean
  /** Persisted duration from content block */
  duration?: number
  /** Persisted start time from content block */
  startTime?: number
}

/**
 * ThinkingBlock component displays AI reasoning/thinking process
 * Shows collapsible content with duration timer
 * Auto-expands during streaming and collapses when complete
 *
 * @param props - Component props
 * @returns Thinking block with expandable content and timer
 */
export function ThinkingBlock({
  content,
  isStreaming = false,
  duration: persistedDuration,
  startTime: persistedStartTime,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [duration, setDuration] = useState(persistedDuration ?? 0)
  const userCollapsedRef = useRef<boolean>(false)
  const startTimeRef = useRef<number>(persistedStartTime ?? Date.now())

  /**
   * Updates start time reference when persisted start time changes
   */
  useEffect(() => {
    if (typeof persistedStartTime === 'number') {
      startTimeRef.current = persistedStartTime
    }
  }, [persistedStartTime])

  /**
   * Auto-expands block when streaming with content
   * Auto-collapses when streaming ends
   */
  useEffect(() => {
    if (!isStreaming) {
      setIsExpanded(false)
      userCollapsedRef.current = false
      return
    }

    if (!userCollapsedRef.current && content && content.trim().length > 0) {
      setIsExpanded(true)
    }
  }, [isStreaming, content])

  /**
   * Updates duration timer during streaming
   * Uses persisted duration when available
   */
  useEffect(() => {
    if (typeof persistedDuration === 'number') {
      setDuration(persistedDuration)
      return
    }

    if (isStreaming) {
      const interval = setInterval(() => {
        setDuration(Date.now() - startTimeRef.current)
      }, TIMER_UPDATE_INTERVAL)
      return () => clearInterval(interval)
    }

    setDuration(Date.now() - startTimeRef.current)
  }, [isStreaming, persistedDuration])

  /**
   * Formats duration in milliseconds to human-readable format
   * @param ms - Duration in milliseconds
   * @returns Formatted string (e.g., "150ms" or "2.5s")
   */
  const formatDuration = (ms: number) => {
    if (ms < SECONDS_THRESHOLD) {
      return `${ms}ms`
    }
    const seconds = (ms / SECONDS_THRESHOLD).toFixed(1)
    return `${seconds}s`
  }

  return (
    <div className='mt-1 mb-0'>
      <button
        onClick={() => {
          setIsExpanded((v) => {
            const next = !v
            // If user collapses during streaming, remember to not auto-expand again
            if (!next && isStreaming) userCollapsedRef.current = true
            return next
          })
        }}
        className={cn(
          'mb-1 inline-flex items-center gap-1 text-[11px] text-gray-400 transition-colors hover:text-gray-500',
          'font-normal italic'
        )}
        type='button'
      >
        <Brain className='h-3 w-3' />
        <span>
          Thought for {formatDuration(duration)}
          {isExpanded ? ' (click to collapse)' : ''}
        </span>
        {isStreaming && (
          <span className='inline-flex h-1 w-1 animate-pulse rounded-full bg-gray-400' />
        )}
      </button>

      {isExpanded && (
        <div className='ml-1 border-gray-200 border-l-2 pl-2 dark:border-gray-700'>
          <pre className='whitespace-pre-wrap font-mono text-[11px] text-gray-400 dark:text-gray-500'>
            {content}
            {isStreaming && (
              <span className='ml-1 inline-block h-2 w-1 animate-pulse bg-gray-400' />
            )}
          </pre>
        </div>
      )}
    </div>
  )
}
