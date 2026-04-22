'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Expandable, ExpandableContent } from '@/components/emcn'
import { BrainIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'

interface ThinkingBlockProps {
  content: string
  isActive: boolean
  isStreaming?: boolean
  startedAt?: number
  endedAt?: number
}

const MIN_VISIBLE_THINKING_MS = 3000

export function ThinkingBlock({
  content,
  isActive,
  isStreaming = false,
  startedAt,
  endedAt,
}: ThinkingBlockProps) {
  // Start collapsed so the `Expandable` plays its height-open animation
  // when `expanded` flips to true below — otherwise the panel mounts
  // already-open and jumps up with its full content in one frame.
  const [expanded, setExpanded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const wasActiveRef = useRef<boolean | null>(null)
  // Suppress active thinking until it exceeds MIN_VISIBLE_THINKING_MS.
  // Completed-<=threshold is filtered upstream in message-content, so if
  // we're mounted with isActive=false we've already passed that gate.
  const [thresholdReached, setThresholdReached] = useState(() => {
    if (!isActive || startedAt === undefined) return true
    return Date.now() - startedAt > MIN_VISIBLE_THINKING_MS
  })

  useEffect(() => {
    if (thresholdReached) return
    if (!isActive || startedAt === undefined) {
      setThresholdReached(true)
      return
    }
    const remainingMs = Math.max(0, MIN_VISIBLE_THINKING_MS - (Date.now() - startedAt))
    const id = window.setTimeout(() => setThresholdReached(true), remainingMs + 50)
    return () => window.clearTimeout(id)
  }, [isActive, startedAt, thresholdReached])

  useEffect(() => {
    // Wait until the threshold has actually been reached — otherwise this
    // effect fires during the 3-second hidden period (while the component
    // returns null) and sets `expanded` to true before the panel is even
    // rendered, so the Collapsible mounts already-open with no animation.
    if (!thresholdReached) return
    if (wasActiveRef.current === isActive) return
    // On first run (wasActiveRef === null): open if the stream is live —
    // even when thinking itself has already ended — so a mid-stream refresh
    // shows the thinking panel open while the rest of the response is still
    // being generated. Subsequent runs only react to the isActive transition
    // (auto-collapse when thinking ends).
    const isFirstRun = wasActiveRef.current === null
    wasActiveRef.current = isActive
    const target = isFirstRun ? isActive || isStreaming : isActive
    // Defer to the next frame so Radix Collapsible paints the closed state
    // first, then sees the transition to open. Without this, React can batch
    // the mount + flip into a single commit and the animation never plays.
    const id = window.requestAnimationFrame(() => setExpanded(target))
    return () => window.cancelAnimationFrame(id)
  }, [isActive, isStreaming, thresholdReached])

  useLayoutEffect(() => {
    if (!isActive || !expanded) return
    const el = panelRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [content, isActive, expanded])

  if (!thresholdReached) return null

  const elapsedMs =
    startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt
      ? endedAt - startedAt
      : undefined
  const elapsedSeconds =
    elapsedMs !== undefined ? Math.max(1, Math.round(elapsedMs / 1000)) : undefined
  const label = isActive
    ? 'Thinking'
    : elapsedSeconds !== undefined
      ? `Thought for ${elapsedSeconds}s`
      : 'Thought'

  return (
    <div className='flex flex-col gap-1.5'>
      <button
        type='button'
        onClick={() => setExpanded((prev) => !prev)}
        className='flex cursor-pointer items-center gap-2'
      >
        <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
          <BrainIcon className='h-[14px] w-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='font-base text-[var(--text-body)] text-sm'>{label}</span>
        <ChevronDown
          className={cn(
            'h-[7px] w-[9px] text-[var(--text-icon)] transition-transform duration-150',
            !expanded && '-rotate-90'
          )}
        />
      </button>

      <Expandable expanded={expanded}>
        <ExpandableContent>
          <div ref={panelRef} className='max-h-[110px] overflow-y-scroll pt-0.5 pr-2 pl-6'>
            <div className='whitespace-pre-wrap break-words font-base text-[13px] text-[var(--text-secondary)] leading-[18px] opacity-60'>
              {content}
            </div>
          </div>
        </ExpandableContent>
      </Expandable>
    </div>
  )
}
