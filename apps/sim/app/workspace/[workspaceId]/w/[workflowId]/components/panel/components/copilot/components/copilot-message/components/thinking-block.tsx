'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronUp } from 'lucide-react'

/**
 * Max height for thinking content before internal scrolling kicks in
 */
const THINKING_MAX_HEIGHT = 200

/**
 * Interval for auto-scroll during streaming (ms)
 */
const SCROLL_INTERVAL = 100

/**
 * Timer update interval in milliseconds
 */
const TIMER_UPDATE_INTERVAL = 100

/**
 * Props for the ThinkingBlock component
 */
interface ThinkingBlockProps {
  /** Content of the thinking block */
  content: string
  /** Whether the block is currently streaming */
  isStreaming?: boolean
  /** Whether there are more content blocks after this one (e.g., tool calls) */
  hasFollowingContent?: boolean
}

/**
 * ThinkingBlock component displays AI reasoning/thinking process
 * Shows collapsible content with duration timer
 * Auto-expands during streaming and collapses when complete
 * Auto-collapses when a tool call or other content comes in after it
 *
 * @param props - Component props
 * @returns Thinking block with expandable content and timer
 */
export function ThinkingBlock({
  content,
  isStreaming = false,
  hasFollowingContent = false,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [duration, setDuration] = useState(0)
  const userCollapsedRef = useRef<boolean>(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const startTimeRef = useRef<number>(Date.now())

  /**
   * Auto-expands block when streaming with content
   * Auto-collapses when streaming ends OR when following content arrives
   */
  useEffect(() => {
    // Collapse if streaming ended or if there's following content (like a tool call)
    if (!isStreaming || hasFollowingContent) {
      setIsExpanded(false)
      userCollapsedRef.current = false
      return
    }

    if (!userCollapsedRef.current && content && content.trim().length > 0) {
      setIsExpanded(true)
    }
  }, [isStreaming, content, hasFollowingContent])

  // Reset start time when streaming begins
  useEffect(() => {
    if (isStreaming && !hasFollowingContent) {
      startTimeRef.current = Date.now()
      setDuration(0)
    }
  }, [isStreaming, hasFollowingContent])

  // Update duration timer during streaming (stop when following content arrives)
  useEffect(() => {
    // Stop timer if not streaming or if there's following content (thinking is done)
    if (!isStreaming || hasFollowingContent) return

    const interval = setInterval(() => {
      setDuration(Date.now() - startTimeRef.current)
    }, TIMER_UPDATE_INTERVAL)

    return () => clearInterval(interval)
  }, [isStreaming, hasFollowingContent])

  // Auto-scroll to bottom during streaming using interval (same as copilot chat)
  useEffect(() => {
    if (!isStreaming || !isExpanded) return

    const intervalId = window.setInterval(() => {
      const container = scrollContainerRef.current
      if (!container) return

      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      })
    }, SCROLL_INTERVAL)

    return () => window.clearInterval(intervalId)
  }, [isStreaming, isExpanded])

  /**
   * Formats duration in milliseconds to seconds
   * Always shows seconds, rounded to nearest whole second, minimum 1s
   */
  const formatDuration = (ms: number) => {
    const seconds = Math.max(1, Math.round(ms / 1000))
    return `${seconds}s`
  }

  const hasContent = content && content.trim().length > 0
  // Thinking is "done" when streaming ends OR when there's following content (like a tool call)
  const isThinkingDone = !isStreaming || hasFollowingContent
  const label = isThinkingDone ? 'Thought' : 'Thinking'
  const durationText = ` for ${formatDuration(duration)}`

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
        className='mb-1 inline-flex items-center gap-1 text-left font-[470] font-season text-[var(--text-secondary)] text-sm transition-colors hover:text-[var(--text-primary)]'
        type='button'
        disabled={!hasContent}
      >
        <span className='relative inline-block'>
          <span className='text-[var(--text-tertiary)]'>{label}</span>
          <span className='text-[var(--text-muted)]'>{durationText}</span>
          {!isThinkingDone && (
            <span
              aria-hidden='true'
              className='pointer-events-none absolute inset-0 select-none overflow-hidden'
            >
              <span
                className='block text-transparent'
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%)',
                  backgroundSize: '200% 100%',
                  backgroundRepeat: 'no-repeat',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  animation: 'thinking-shimmer 1.4s ease-in-out infinite',
                  mixBlendMode: 'screen',
                }}
              >
                {label}
                {durationText}
              </span>
            </span>
          )}
          <style>{`
            @keyframes thinking-shimmer {
              0% { background-position: 150% 0; }
              50% { background-position: 0% 0; }
              100% { background-position: -150% 0; }
            }
          `}</style>
        </span>
        {hasContent && (
          <ChevronUp
            className={clsx(
              'h-3 w-3 transition-transform',
              isExpanded ? 'rotate-180' : 'rotate-90'
            )}
            aria-hidden='true'
          />
        )}
      </button>

      {isExpanded && (
        <div
          ref={scrollContainerRef}
          className='ml-1 overflow-y-auto border-[var(--border-1)] border-l-2 pl-2'
          style={{ maxHeight: THINKING_MAX_HEIGHT }}
        >
          <pre className='whitespace-pre-wrap font-[470] font-season text-[12px] text-[var(--text-tertiary)] leading-[1.15rem]'>
            {content}
            {!isThinkingDone && (
              <span className='ml-1 inline-block h-2 w-1 animate-pulse bg-[var(--text-tertiary)]' />
            )}
          </pre>
        </div>
      )}
    </div>
  )
}
