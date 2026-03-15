'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { ChevronDown } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { formatDuration } from '@/lib/core/utils/formatting'

const CHARS_PER_FRAME = 3
const SCROLL_INTERVAL_MS = 50

interface SubagentThinkingBlockProps {
  content: string
  isStreaming: boolean
  duration?: number
}

/**
 * Streams text character-by-character via rAF during streaming,
 * then snaps to full content when done.
 */
const StreamingText = memo(
  ({ content, isStreaming }: { content: string; isStreaming: boolean }) => {
    const [displayed, setDisplayed] = useState(() => (isStreaming ? '' : content))
    const contentRef = useRef(content)
    const indexRef = useRef(isStreaming ? 0 : content.length)
    const rafRef = useRef<number | null>(null)

    useEffect(() => {
      contentRef.current = content

      if (!isStreaming) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        setDisplayed(content)
        indexRef.current = content.length
        return
      }

      if (indexRef.current >= content.length) return

      const step = () => {
        const cur = contentRef.current
        const next = Math.min(indexRef.current + CHARS_PER_FRAME, cur.length)
        indexRef.current = next
        setDisplayed(cur.slice(0, next))
        if (next < cur.length) {
          rafRef.current = requestAnimationFrame(step)
        }
      }
      rafRef.current = requestAnimationFrame(step)

      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
      }
    }, [content, isStreaming])

    return (
      <p className='whitespace-pre-wrap text-[12px] text-[var(--text-muted)] leading-[1.4]'>
        {displayed}
      </p>
    )
  },
  (prev, next) => prev.content === next.content && prev.isStreaming === next.isStreaming
)
StreamingText.displayName = 'StreamingText'

/**
 * Collapsible thinking block for subagent content in the home chat.
 *
 * Streaming: "Thinking" shimmer label, auto-expands with scrolling carousel.
 * Done: collapses to "Thought for Xs", click to re-expand.
 */
export function SubagentThinkingBlock({
  content,
  isStreaming,
  duration,
}: SubagentThinkingBlockProps) {
  const trimmed = content.trim()
  const hasContent = trimmed.length > 0

  const [expanded, setExpanded] = useState(false)
  const userCollapsedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isStreaming && hasContent && !userCollapsedRef.current) {
      setExpanded(true)
    }
    if (!isStreaming) {
      setExpanded(false)
      userCollapsedRef.current = false
    }
  }, [isStreaming, hasContent])

  useEffect(() => {
    if (!isStreaming || !expanded) return
    const id = window.setInterval(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    }, SCROLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [isStreaming, expanded])

  const toggle = () => {
    setExpanded((v) => {
      const next = !v
      if (!next && isStreaming) userCollapsedRef.current = true
      return next
    })
  }

  const roundedMs = duration != null ? Math.max(1000, Math.round(duration / 1000) * 1000) : null
  const label = isStreaming ? 'Thinking' : `Thought for ${formatDuration(roundedMs) ?? '…'}`

  return (
    <div className='pl-[24px]'>
      <style>{`
        @keyframes subagent-shimmer {
          0% { background-position: 150% 0; }
          50% { background-position: 0% 0; }
          100% { background-position: -150% 0; }
        }
      `}</style>

      <button
        type='button'
        onClick={toggle}
        disabled={!hasContent && !isStreaming}
        className='group inline-flex items-center gap-1 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]'
      >
        <span className='relative inline-block'>
          <span className='text-[var(--text-tertiary)]'>{label}</span>
          {isStreaming && (
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
                  animation: 'subagent-shimmer 1.4s ease-in-out infinite',
                  mixBlendMode: 'screen',
                }}
              >
                {label}
              </span>
            </span>
          )}
        </span>
        {hasContent && (
          <ChevronDown
            className={cn(
              'h-[7px] w-[9px] transition-all group-hover:opacity-100',
              expanded ? 'opacity-100' : '-rotate-90 opacity-0'
            )}
          />
        )}
      </button>

      <div
        ref={scrollRef}
        className={cn(
          'overflow-y-auto transition-all duration-150 ease-out',
          expanded ? 'mt-1 max-h-[150px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <StreamingText content={trimmed} isStreaming={isStreaming} />
      </div>
    </div>
  )
}
