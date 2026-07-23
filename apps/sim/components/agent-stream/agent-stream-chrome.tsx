'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { Check, ChevronDown, Circle, Square, X } from 'lucide-react'
import type {
  AgentStreamToolCall,
  AgentStreamToolStatus,
} from '@/components/agent-stream/tool-call-lifecycle'
import { ShimmerText } from '@/components/ui'
import { humanizeToolName } from '@/lib/copilot/tools/tool-display'

/** Distance from bottom (px) within which we keep following new thinking text. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 24

/**
 * Open / pinned-open / auto-collapse state shared by both chrome panels:
 * streaming forces the panel open, the panel auto-collapses when streaming
 * ends unless the user pinned it open, and manual toggles while idle pin it.
 */
function useAutoCollapseOpen(isStreaming: boolean, onOpen?: (streaming: boolean) => void) {
  const [open, setOpen] = useState(!!isStreaming)
  const [userPinnedOpen, setUserPinnedOpen] = useState(false)
  const wasStreamingRef = useRef(!!isStreaming)

  useEffect(() => {
    const wasStreaming = wasStreamingRef.current
    wasStreamingRef.current = !!isStreaming

    if (isStreaming) {
      setOpen(true)
      setUserPinnedOpen(false)
      return
    }

    if (wasStreaming && !isStreaming && !userPinnedOpen) {
      setOpen(false)
    }
  }, [isStreaming, userPinnedOpen])

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev
      if (!isStreaming) {
        setUserPinnedOpen(next)
      } else {
        setUserPinnedOpen(false)
      }
      if (next) {
        onOpen?.(!!isStreaming)
      }
      return next
    })
  }

  return { open, toggle }
}

export interface AgentStreamThinkingChromeProps {
  thinking: string
  isStreaming?: boolean
}

export function AgentStreamThinkingChrome({
  thinking,
  isStreaming = false,
}: AgentStreamThinkingChromeProps) {
  const [stickToBottom, setStickToBottom] = useState(true)
  const [overflowing, setOverflowing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** After a manual reopen of completed thoughts, jump to the top once. */
  const reopenFromTopRef = useRef(false)

  const { open, toggle } = useAutoCollapseOpen(isStreaming, (streaming) => {
    if (streaming) {
      setStickToBottom(true)
    } else {
      // ChatGPT-style: reopen completed thoughts from the top.
      setStickToBottom(false)
      reopenFromTopRef.current = true
    }
  })

  useEffect(() => {
    if (isStreaming) {
      setStickToBottom(true)
    }
  }, [isStreaming])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !open) return

    setOverflowing(el.scrollHeight > el.clientHeight + 1)

    if (reopenFromTopRef.current && !isStreaming) {
      el.scrollTop = 0
      reopenFromTopRef.current = false
      return
    }

    if (isStreaming && stickToBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [thinking, open, isStreaming, stickToBottom])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX
    setStickToBottom(nearBottom)
    setOverflowing(el.scrollHeight > el.clientHeight + 1)
  }

  const label = isStreaming ? 'Thinking…' : 'Thought for a moment'

  return (
    <div className='mb-3'>
      <button
        type='button'
        className='flex items-center gap-1 text-[var(--text-muted)] text-sm transition-colors hover:text-[var(--text-secondary)]'
        onClick={toggle}
        aria-expanded={open}
        data-testid='agent-stream-thinking-toggle'
      >
        <ChevronDown
          className={cn(
            'size-[14px] transition-transform duration-150',
            open ? 'rotate-0' : '-rotate-90'
          )}
          strokeWidth={2}
        />
        {isStreaming ? (
          <ShimmerText
            className='text-sm [--shimmer-rest:var(--text-muted)]'
            data-testid='agent-stream-thinking-label'
          >
            {label}
          </ShimmerText>
        ) : (
          <span data-testid='agent-stream-thinking-label'>{label}</span>
        )}
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
        aria-hidden={!open}
      >
        <div className='min-h-0 overflow-hidden'>
          <div className='relative mt-2'>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              data-testid='agent-stream-thinking-body'
              className={cn(
                'max-h-40 overflow-y-auto border-[var(--border)] border-l pl-3',
                'whitespace-pre-wrap break-words text-sm leading-relaxed',
                !isStreaming && 'text-[var(--text-muted)]'
              )}
            >
              {/* Shimmer on an inner node — never on the scroll shell. background-clip:text
                  on overflow-y-auto breaks scroll/overflow in Chromium. */}
              {isStreaming ? (
                <ShimmerText
                  as='div'
                  className='[--shimmer-rest:var(--text-muted)]'
                  data-testid='agent-stream-thinking-shimmer'
                >
                  {thinking}
                </ShimmerText>
              ) : (
                thinking
              )}
            </div>
            {open && isStreaming && overflowing && (
              <div
                aria-hidden
                className='pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[var(--bg)] to-transparent'
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolStatusIcon({ status }: { status: AgentStreamToolStatus }) {
  if (status === 'success') {
    return <Check className='size-[14px] shrink-0' strokeWidth={2} aria-hidden />
  }
  if (status === 'error') {
    return <X className='size-[14px] shrink-0' strokeWidth={2} aria-hidden />
  }
  if (status === 'cancelled') {
    return <Square className='size-3 shrink-0 fill-current' strokeWidth={0} aria-hidden />
  }
  return <Circle className='size-3 shrink-0' strokeWidth={2} aria-hidden />
}

export interface AgentStreamToolCallsChromeProps {
  toolCalls: AgentStreamToolCall[]
  isStreaming?: boolean
}

export function AgentStreamToolCallsChrome({
  toolCalls,
  isStreaming,
}: AgentStreamToolCallsChromeProps) {
  const { open, toggle } = useAutoCollapseOpen(!!isStreaming)

  return (
    <div className='mb-3'>
      <button
        type='button'
        className='flex items-center gap-1 text-[var(--text-muted)] text-sm transition-colors hover:text-[var(--text-secondary)]'
        onClick={toggle}
        aria-expanded={open}
        data-testid='agent-stream-tools-toggle'
      >
        <ChevronDown
          className={cn('size-[14px] transition-transform', open ? 'rotate-0' : '-rotate-90')}
          strokeWidth={2}
        />
        <span>{isStreaming ? 'Using tools…' : 'Tools'}</span>
      </button>
      {open && (
        <ul className='mt-2 space-y-1.5 text-[var(--text-muted)] text-sm'>
          {toolCalls.map((tool) => (
            <li key={tool.key} className='flex items-center gap-2'>
              <ToolStatusIcon status={tool.status} />
              <span className='truncate'>
                {tool.displayName || humanizeToolName(tool.name)}
                {tool.status === 'running' ? '…' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
