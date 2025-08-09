'use client'

import { useState, useEffect } from 'react'
import { Brain } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ThinkingBlockProps {
  content: string
  isStreaming?: boolean
  duration?: number // Persisted duration from content block
  startTime?: number // Persisted start time from content block
}

export function ThinkingBlock({ content, isStreaming = false, duration: persistedDuration, startTime: persistedStartTime }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [duration, setDuration] = useState(persistedDuration || 0)
  const [startTime] = useState(persistedStartTime || Date.now())
  
  useEffect(() => {
    if (isStreaming && !persistedDuration) {
      const interval = setInterval(() => {
        setDuration(Date.now() - startTime)
      }, 100)
      return () => clearInterval(interval)
    } else if (persistedDuration) {
      // Use persisted duration
      setDuration(persistedDuration)
    } else {
      // Set final duration when streaming stops
      setDuration(Date.now() - startTime)
    }
  }, [isStreaming, startTime, persistedDuration])
  
  // Format duration
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const seconds = (ms / 1000).toFixed(1)
    return `${seconds}s`
  }
  
  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className={cn(
          "inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-500 transition-colors",
          "font-normal italic"
        )}
        type="button"
      >
        <Brain className="h-3 w-3" />
        <span>Thought for {formatDuration(duration)}</span>
        {isStreaming && (
          <span className="inline-flex h-1 w-1 animate-pulse rounded-full bg-gray-400" />
        )}
      </button>
    )
  }
  
  return (
    <div className="my-1">
      <button
        onClick={() => setIsExpanded(false)}
        className={cn(
          "inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-500 transition-colors mb-1",
          "font-normal italic"
        )}
        type="button"
      >
        <Brain className="h-3 w-3" />
        <span>Thought for {formatDuration(duration)} (click to collapse)</span>
      </button>
      <div className="pl-2 border-l-2 border-gray-200 dark:border-gray-700 ml-1">
        <pre className="whitespace-pre-wrap font-mono text-xs text-gray-400 dark:text-gray-500">
          {content}
          {isStreaming && (
            <span className="ml-1 inline-block h-2 w-1 animate-pulse bg-gray-400" />
          )}
        </pre>
      </div>
    </div>
  )
} 