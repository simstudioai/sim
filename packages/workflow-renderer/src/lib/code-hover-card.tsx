'use client'

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Code, isTextClipped, Popover, PopoverAnchor, PopoverContent } from '@sim/emcn'
import type { CodePreview } from '../types'

const OPEN_DELAY_MS = 300
const TRIGGER_EXIT_GRACE_MS = 600
const CONTENT_EXIT_GRACE_MS = 120
const CODE_TOOLTIP_MAX_HEIGHT_PX = 256

interface CodeHoverCardProps {
  preview: CodePreview
  className: string
  children: ReactNode
}

/** Interactive, two-axis-scrollable source preview anchored to a canvas code chip. */
export function CodeHoverCard({ preview, className, children }: CodeHoverCardProps) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current === null) return
    window.clearTimeout(openTimerRef.current)
    openTimerRef.current = null
  }, [])

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const handleTriggerPointerEnter = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!isTextClipped(event.currentTarget)) return
    clearCloseTimer()
    if (open || openTimerRef.current !== null) return
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null
      setOpen(true)
    }, OPEN_DELAY_MS)
  }

  const scheduleClose = (delay: number) => {
    clearOpenTimer()
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
    }, delay)
  }

  const openImmediatelyIfClipped = (trigger: HTMLSpanElement) => {
    if (!isTextClipped(trigger)) return
    clearOpenTimer()
    clearCloseTimer()
    setOpen(true)
  }

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        clearOpenTimer()
        clearCloseTimer()
      }
      setOpen(nextOpen)
    },
    [clearCloseTimer, clearOpenTimer]
  )

  useEffect(
    () => () => {
      clearOpenTimer()
      clearCloseTimer()
    },
    [clearCloseTimer, clearOpenTimer]
  )

  const handleTriggerPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      event.stopPropagation()
      if (open) {
        handleOpenChange(false)
      } else {
        openImmediatelyIfClipped(event.currentTarget)
      }
      return
    }
    handleOpenChange(false)
  }

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      handleOpenChange(false)
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    event.stopPropagation()
    if (open) {
      handleOpenChange(false)
    } else {
      openImmediatelyIfClipped(event.currentTarget)
    }
  }

  const handleContentKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    handleOpenChange(false)
    triggerRef.current?.focus()
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        <span
          ref={triggerRef}
          role='button'
          tabIndex={0}
          aria-haspopup='dialog'
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          className={className}
          onPointerEnter={handleTriggerPointerEnter}
          onPointerLeave={() => {
            if (document.activeElement !== triggerRef.current) {
              scheduleClose(TRIGGER_EXIT_GRACE_MS)
            }
          }}
          onPointerDown={handleTriggerPointerDown}
          onFocus={(event) => openImmediatelyIfClipped(event.currentTarget)}
          onBlur={() => scheduleClose(TRIGGER_EXIT_GRACE_MS)}
          onKeyDown={handleTriggerKeyDown}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        id={contentId}
        role='dialog'
        tabIndex={0}
        aria-label='Code preview'
        data-code-hover-card=''
        align='start'
        side='bottom'
        sideOffset={-4}
        collisionPadding={16}
        appearance='tooltip'
        maxHeight={CODE_TOOLTIP_MAX_HEIGHT_PX}
        onPointerEnter={clearCloseTimer}
        onPointerLeave={() => scheduleClose(CONTENT_EXIT_GRACE_MS)}
        onFocus={clearCloseTimer}
        onBlur={() => scheduleClose(CONTENT_EXIT_GRACE_MS)}
        onKeyDown={handleContentKeyDown}
        className='nodrag nowheel overflow-hidden overscroll-contain p-0'
      >
        <Code.Viewer
          code={preview.code}
          language={preview.language}
          density='compact'
          highlightWorkflowReferences
          className='max-h-[min(16rem,calc(100vh-2rem))] min-h-0 rounded-none border-0 bg-[var(--bg)] shadow-none dark:bg-[var(--bg)]'
        />
      </PopoverContent>
    </Popover>
  )
}
