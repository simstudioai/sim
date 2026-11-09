'use client'

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  calculateGutterWidth,
  highlightCodeLine,
} from '@/app/(product)/_components/workspace/workflows/canvas/workflow-block/code-highlight'
import styles from '@/app/(product)/_components/workspace/workflows/canvas/workflow-block/code-hover-card.module.css'
import {
  FLOATING_OPEN_EVENT,
  floatingContainer,
  useFloatingPosition,
} from '@/app/(product)/_components/workspace/workflows/canvas/workflow-block/floating-layer'
import { isTextClipped } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-block/text-clip'
import type { CodePreview } from '@/app/(product)/_components/workspace/workflows/canvas/workflow-block/types'

const OPEN_DELAY_MS = 300
const TRIGGER_EXIT_GRACE_MS = 600
const CONTENT_EXIT_GRACE_MS = 120
/** The legacy popover's `sideOffset`: it tucks 4px over the chip it previews. */
const POPUP_GAP_PX = -4
const COLLISION_PADDING_PX = 16

interface CodeHoverCardProps {
  preview: CodePreview
  className: string
  children: ReactNode
}

/**
 * Interactive, vertically scrollable source preview anchored to a canvas code chip. The chip keeps
 * its canvas look; the preview is an EMCN floating panel holding the legacy code viewer (gutter,
 * wrapped lines, Prism colors, highlighted workflow references). It opens after a hover delay or
 * at once on keyboard focus, only while the chip is clipped, and never takes focus by itself.
 */
export function CodeHoverCard({ preview, className, children }: CodeHoverCardProps) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
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
  const close = useCallback(() => handleOpenChange(false), [handleOpenChange])

  useEffect(
    () => () => {
      clearOpenTimer()
      clearCloseTimer()
    },
    [clearCloseTimer, clearOpenTimer]
  )

  /* The legacy popover's dismissal layer: Escape or a press outside the chip and panel closes it,
     and another tooltip or preview opening takes its place. */
  useEffect(() => {
    if (!open) return
    const owner = triggerRef.current?.ownerDocument ?? document
    owner.dispatchEvent(new Event(FLOATING_OPEN_EVENT))
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    owner.addEventListener(FLOATING_OPEN_EVENT, close)
    owner.addEventListener('pointerdown', onPointerDown, true)
    owner.addEventListener('keydown', onKeyDown)
    return () => {
      owner.removeEventListener(FLOATING_OPEN_EVENT, close)
      owner.removeEventListener('pointerdown', onPointerDown, true)
      owner.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  useFloatingPosition(open ? triggerRef.current : null, popupRef, {
    placement: 'bottom-start',
    gap: POPUP_GAP_PX,
    padding: COLLISION_PADDING_PX,
    onAnchorLost: close,
  })

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

  const trigger = triggerRef.current

  return (
    <>
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
      {open &&
        trigger &&
        createPortal(
          <div
            ref={popupRef}
            id={contentId}
            role='dialog'
            tabIndex={-1}
            aria-label='Code preview'
            data-code-hover-card=''
            data-material='floating'
            data-elevation='menu'
            className={`nodrag nowheel ${styles.panel}`}
            onPointerEnter={clearCloseTimer}
            onPointerLeave={() => scheduleClose(CONTENT_EXIT_GRACE_MS)}
            onFocus={clearCloseTimer}
            onBlur={() => scheduleClose(CONTENT_EXIT_GRACE_MS)}
            onKeyDown={handleContentKeyDown}
          >
            <CodeViewer code={preview.code} language={preview.language} />
          </div>,
          floatingContainer(trigger)
        )}
    </>
  )
}

/** The legacy compact, wrapped, gutter-numbered `Code.Viewer` the preview shows. */
function CodeViewer({ code, language }: CodePreview) {
  const lines = useMemo(() => code.split('\n'), [code])
  const gutterWidth = calculateGutterWidth(lines.length)
  const highlighted = useMemo(
    () => lines.map((line) => highlightCodeLine(line, language) || '&nbsp;'),
    [lines, language]
  )

  return (
    <div className={styles.viewer}>
      <div className={styles.theme}>
        <div className={styles.grid} style={{ gridTemplateColumns: `${gutterWidth}px 1fr` }}>
          {highlighted.map((html, index) => (
            <CodeLine key={index} lineNumber={index + 1} html={html} />
          ))}
        </div>
      </div>
    </div>
  )
}

interface CodeLineProps {
  lineNumber: number
  html: string
}

function CodeLine({ lineNumber, html }: CodeLineProps) {
  return (
    <>
      <div className={styles.lineNumber}>{lineNumber}</div>
      {/* Prism output over escaped source: the same markup the legacy viewer injected. */}
      <pre className={styles.line} dangerouslySetInnerHTML={{ __html: html }} />
    </>
  )
}
