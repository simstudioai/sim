'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronUp } from 'lucide-react'

/**
 * Timer update interval in milliseconds
 */
const TIMER_UPDATE_INTERVAL = 100

/**
 * Milliseconds threshold for displaying as seconds
 */
const SECONDS_THRESHOLD = 1000

/**
 * Props for the ShimmerOverlayText component
 */
interface ShimmerOverlayTextProps {
  /** Label text to display */
  label: string
  /** Value text to display */
  value: string
  /** Whether the shimmer animation is active */
  active?: boolean
}

/**
 * ShimmerOverlayText component for thinking block
 * Applies shimmer effect to the "Thought for X.Xs" text during streaming
 *
 * @param props - Component props
 * @returns Text with optional shimmer overlay effect
 */
function ShimmerOverlayText({ label, value, active = false }: ShimmerOverlayTextProps) {
  return (
    <span className='relative inline-block'>
      <span style={{ color: '#B8B8B8' }}>{label}</span>
      <span style={{ color: '#787878' }}>{value}</span>
      {active ? (
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
            {value}
          </span>
        </span>
      ) : null}
      <style>{`
        @keyframes thinking-shimmer {
          0% { background-position: 150% 0; }
          50% { background-position: 0% 0; }
          100% { background-position: -150% 0; }
        }
      `}</style>
    </span>
  )
}

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

  const hasContent = content && content.trim().length > 0

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
        <ShimmerOverlayText
          label='Thought'
          value={` for ${formatDuration(duration)}`}
          active={isStreaming}
        />
        {hasContent && (
          <ChevronUp
            className={clsx('h-3 w-3 transition-transform', isExpanded && 'rotate-180')}
            aria-hidden='true'
          />
        )}
      </button>

      {isExpanded && (
        <div className='ml-1 border-[var(--border-strong)] border-l-2 pl-2'>
          <pre
            className='whitespace-pre-wrap font-[470] font-season text-[12px] leading-[1.15rem]'
            style={{ color: '#B8B8B8' }}
          >
            {content}
            {isStreaming && (
              <span className='ml-1 inline-block h-2 w-1 animate-pulse bg-[#B8B8B8]' />
            )}
          </pre>
        </div>
      )}
    </div>
  )
}
