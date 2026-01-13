'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronUp } from 'lucide-react'
import CopilotMarkdownRenderer from './markdown-renderer'

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
  /** Custom label for the thinking block (e.g., "Thinking", "Exploring"). Defaults to "Thought" */
  label?: string
  /** Whether special tags (plan, options) are present - triggers collapse */
  hasSpecialTags?: boolean
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
  label = 'Thought',
  hasSpecialTags = false,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [duration, setDuration] = useState(0)
  const [userHasScrolledAway, setUserHasScrolledAway] = useState(false)
  const userCollapsedRef = useRef<boolean>(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const startTimeRef = useRef<number>(Date.now())
  const lastScrollTopRef = useRef(0)
  const programmaticScrollRef = useRef(false)

  /**
   * Auto-expands block when streaming with content
   * Auto-collapses when streaming ends OR when following content arrives
   */
  useEffect(() => {
    // Collapse if streaming ended or if there's following content (like a tool call)
    if (!isStreaming || hasFollowingContent) {
      setIsExpanded(false)
      userCollapsedRef.current = false
      setUserHasScrolledAway(false)
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
      setUserHasScrolledAway(false)
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

  // Handle scroll events to detect user scrolling away
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !isExpanded) return

    const handleScroll = () => {
      if (programmaticScrollRef.current) return

      const { scrollTop, scrollHeight, clientHeight } = container
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const isNearBottom = distanceFromBottom <= 20

      const delta = scrollTop - lastScrollTopRef.current
      const movedUp = delta < -2

      if (movedUp && !isNearBottom) {
        setUserHasScrolledAway(true)
      }

      // Re-stick if user scrolls back to bottom
      if (userHasScrolledAway && isNearBottom) {
        setUserHasScrolledAway(false)
      }

      lastScrollTopRef.current = scrollTop
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    lastScrollTopRef.current = container.scrollTop

    return () => container.removeEventListener('scroll', handleScroll)
  }, [isExpanded, userHasScrolledAway])

  // Smart auto-scroll: always scroll to bottom while streaming unless user scrolled away
  // This matches the main chat behavior in useScrollManagement
  useEffect(() => {
    if (!isStreaming || !isExpanded || userHasScrolledAway) return

    const intervalId = window.setInterval(() => {
      const container = scrollContainerRef.current
      if (!container) return

      // Always scroll to bottom during streaming (like main chat does)
      // User can break out by scrolling up, which sets userHasScrolledAway
      programmaticScrollRef.current = true
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      })
      window.setTimeout(() => {
        programmaticScrollRef.current = false
      }, 150)
    }, SCROLL_INTERVAL)

    return () => window.clearInterval(intervalId)
  }, [isStreaming, isExpanded, userHasScrolledAway])

  /**
   * Formats duration in milliseconds to seconds
   * Always shows seconds, rounded to nearest whole second, minimum 1s
   */
  const formatDuration = (ms: number) => {
    const seconds = Math.max(1, Math.round(ms / 1000))
    return `${seconds}s`
  }

  const hasContent = content && content.trim().length > 0
  // Thinking is "done" when streaming ends OR when there's following content (like a tool call) OR when special tags appear
  const isThinkingDone = !isStreaming || hasFollowingContent || hasSpecialTags
  const durationText = `${label} for ${formatDuration(duration)}`
  // Convert past tense label to present tense for streaming (e.g., "Thought" → "Thinking")
  const getStreamingLabel = (lbl: string) => {
    if (lbl === 'Thought') return 'Thinking'
    if (lbl.endsWith('ed')) return `${lbl.slice(0, -2)}ing`
    return lbl
  }
  const streamingLabel = getStreamingLabel(label)

  // During streaming: show header with shimmer effect + expanded content
  if (!isThinkingDone) {
    return (
      <div>
        {/* Define shimmer keyframes */}
        <style>{`
          @keyframes thinking-shimmer {
            0% { background-position: 150% 0; }
            50% { background-position: 0% 0; }
            100% { background-position: -150% 0; }
          }
        `}</style>
        <button
          onClick={() => {
            setIsExpanded((v) => {
              const next = !v
              if (!next) userCollapsedRef.current = true
              return next
            })
          }}
          className='group inline-flex items-center gap-1 text-left font-[470] font-season text-[var(--text-secondary)] text-sm transition-colors hover:text-[var(--text-primary)]'
          type='button'
        >
          <span className='relative inline-block'>
            <span className='text-[var(--text-tertiary)]'>{streamingLabel}</span>
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
                {streamingLabel}
              </span>
            </span>
          </span>
          {hasContent && (
            <ChevronUp
              className={clsx(
                'h-3 w-3 transition-all group-hover:opacity-100',
                isExpanded ? 'rotate-180 opacity-100' : 'rotate-90 opacity-0'
              )}
              aria-hidden='true'
            />
          )}
        </button>

        <div
          ref={scrollContainerRef}
          className={clsx(
            'overflow-y-auto transition-all duration-300 ease-in-out',
            isExpanded ? 'mt-1.5 max-h-[200px] opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          {/* Render markdown during streaming with thinking text styling */}
          <div className='[&_*]:!text-[var(--text-muted)] [&_*]:!text-[12px] [&_*]:!leading-[1.3] [&_p]:!m-0 [&_p]:!mb-1 [&_h1]:!text-[12px] [&_h1]:!font-semibold [&_h1]:!m-0 [&_h1]:!mb-1 [&_h2]:!text-[12px] [&_h2]:!font-semibold [&_h2]:!m-0 [&_h2]:!mb-1 [&_h3]:!text-[12px] [&_h3]:!font-semibold [&_h3]:!m-0 [&_h3]:!mb-1 [&_code]:!text-[11px] [&_ul]:!pl-5 [&_ul]:!my-1 [&_ol]:!pl-6 [&_ol]:!my-1 [&_li]:!my-0.5 [&_li]:!py-0 [&_br]:!leading-[0.5] [&_table]:!my-2 [&_th]:!px-2 [&_th]:!py-1 [&_th]:!text-[11px] [&_td]:!px-2 [&_td]:!py-1 [&_td]:!text-[11px] whitespace-pre-wrap font-[470] font-season text-[12px] text-[var(--text-muted)]'>
            <CopilotMarkdownRenderer content={content} />
            <span className='ml-1 inline-block h-2 w-1 animate-pulse bg-[var(--text-muted)]' />
          </div>
        </div>
      </div>
    )
  }

  // After done: show collapsible header with duration
  return (
    <div>
      <button
        onClick={() => {
          setIsExpanded((v) => !v)
        }}
        className='group inline-flex items-center gap-1 text-left font-[470] font-season text-[var(--text-secondary)] text-sm transition-colors hover:text-[var(--text-primary)]'
        type='button'
        disabled={!hasContent}
      >
        <span className='text-[var(--text-tertiary)]'>{durationText}</span>
        {hasContent && (
          <ChevronUp
            className={clsx(
              'h-3 w-3 transition-all group-hover:opacity-100',
              isExpanded ? 'rotate-180 opacity-100' : 'rotate-90 opacity-0'
            )}
            aria-hidden='true'
          />
        )}
      </button>

      <div
        ref={scrollContainerRef}
        className={clsx(
          'overflow-y-auto transition-all duration-300 ease-in-out',
          isExpanded ? 'mt-1.5 max-h-[200px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        {/* Use markdown renderer for completed content */}
        <div className='[&_*]:!text-[var(--text-muted)] [&_*]:!text-[12px] [&_*]:!leading-[1.3] [&_p]:!m-0 [&_p]:!mb-1 [&_h1]:!text-[12px] [&_h1]:!font-semibold [&_h1]:!m-0 [&_h1]:!mb-1 [&_h2]:!text-[12px] [&_h2]:!font-semibold [&_h2]:!m-0 [&_h2]:!mb-1 [&_h3]:!text-[12px] [&_h3]:!font-semibold [&_h3]:!m-0 [&_h3]:!mb-1 [&_code]:!text-[11px] [&_ul]:!pl-5 [&_ul]:!my-1 [&_ol]:!pl-6 [&_ol]:!my-1 [&_li]:!my-0.5 [&_li]:!py-0 [&_br]:!leading-[0.5] [&_table]:!my-2 [&_th]:!px-2 [&_th]:!py-1 [&_th]:!text-[11px] [&_td]:!px-2 [&_td]:!py-1 [&_td]:!text-[11px] whitespace-pre-wrap font-[470] font-season text-[12px] text-[var(--text-muted)]'>
          <CopilotMarkdownRenderer content={content} />
        </div>
      </div>
    </div>
  )
}
