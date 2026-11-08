'use client'

import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
  type VirtualElement,
} from '@floating-ui/dom'
import { createPortal } from 'react-dom'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/field-popover/field-popover.module.css'

const POPUP_GAP = 4
const VIEWPORT_MARGIN = 8

const MIRRORED_STYLES = [
  'font',
  'padding',
  'border',
  'width',
  'lineHeight',
  'boxSizing',
  'letterSpacing',
  'textTransform',
  'textIndent',
  'textAlign',
] as const

/** Where a text field's caret sits on screen, measured with a mirror of the field's text. */
function caretRect(element: HTMLInputElement | HTMLTextAreaElement, index: number): DOMRect {
  const fieldRect = element.getBoundingClientRect()
  const computed = window.getComputedStyle(element)
  const mirror = document.createElement('div')
  for (const prop of MIRRORED_STYLES) mirror.style[prop] = computed[prop]
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = element instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre'
  mirror.style.overflowWrap = 'break-word'
  mirror.textContent = element.value.slice(0, index)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const markerRect = marker.getBoundingClientRect()
  const mirrorRect = mirror.getBoundingClientRect()
  document.body.removeChild(mirror)
  const left = Math.min(
    fieldRect.left + markerRect.left - mirrorRect.left - element.scrollLeft,
    fieldRect.right
  )
  const top = fieldRect.top + markerRect.top - mirrorRect.top - element.scrollTop
  return new DOMRect(left, top, 0, markerRect.height)
}

interface FieldPopoverProps {
  /** Names the list for assistive technology. */
  label: string
  open: boolean
  /** The field the popup hangs from. Focus stays in it while the popup is open. */
  anchor: RefObject<HTMLElement | null>
  /** Hang the popup from the field's caret instead of the whole field. */
  caretIndex?: number
  /** Match the field's width instead of sizing to the rows. */
  matchAnchorWidth?: boolean
  onDismiss: () => void
  children: ReactNode
}

/**
 * A floating list a still-focused field owns: the reference pickers under a text field, or a
 * combobox's options. Arrow keys stay with the field, which marks the active row itself.
 */
export function FieldPopover({
  label,
  open,
  anchor,
  caretIndex,
  matchAnchorWidth,
  onDismiss,
  children,
}: FieldPopoverProps) {
  const popup = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useLayoutEffect(() => {
    if (!open) return
    setContainer(anchor.current?.closest<HTMLElement>('dialog, [data-emcn]') ?? document.body)
  }, [open, anchor])

  useLayoutEffect(() => {
    const field = anchor.current
    const floating = popup.current
    if (!open || !field || !floating || !container) return
    const reference: VirtualElement | HTMLElement =
      caretIndex !== undefined &&
      (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
        ? { getBoundingClientRect: () => caretRect(field, caretIndex), contextElement: field }
        : field
    floating.style.minWidth = ''
    const restingMinWidth = Number.parseFloat(window.getComputedStyle(floating).minWidth) || 0
    const place = () => {
      computePosition(reference, floating, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [
          offset(POPUP_GAP),
          flip({ padding: VIEWPORT_MARGIN }),
          shift({ padding: VIEWPORT_MARGIN }),
          size({
            padding: VIEWPORT_MARGIN,
            apply({ availableHeight, availableWidth, rects }) {
              floating.style.maxHeight = `${Math.max(0, availableHeight)}px`
              floating.style.maxWidth = `${Math.max(0, availableWidth)}px`
              const widest = Math.max(restingMinWidth, rects.reference.width)
              if (matchAnchorWidth) {
                floating.style.minWidth = '0px'
                floating.style.width = `${Math.min(field.getBoundingClientRect().width, availableWidth)}px`
              } else floating.style.minWidth = `${Math.min(widest, availableWidth)}px`
            },
          }),
        ],
      }).then(({ x, y }) => {
        floating.style.left = `${x}px`
        floating.style.top = `${y}px`
      })
    }
    return autoUpdate(field, floating, place)
  }, [open, anchor, caretIndex, matchAnchorWidth, container])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (popup.current?.contains(target) || anchor.current?.contains(target)) return
      dismiss.current()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, anchor])

  if (!open || !container) return null
  return createPortal(
    <div
      ref={popup}
      role='listbox'
      aria-label={label}
      className={styles.popup}
      data-material='floating'
      data-elevation='menu'
      onMouseDown={keepFieldFocus}
    >
      {children}
    </div>,
    container
  )
}

function keepFieldFocus(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('input, textarea')) return
  event.preventDefault()
}

interface FieldPopoverRowProps {
  /** The row the field's arrow keys have reached. */
  active?: boolean
  disabled?: boolean
  /** Opens a nested level rather than choosing a value. */
  nested?: boolean
  leading?: ReactNode
  trailing?: ReactNode
  /** Lets the field scroll the active row into view. */
  index?: number
  onSelect: () => void
  onHover?: () => void
  children: ReactNode
}

export function FieldPopoverRow({
  active,
  disabled,
  nested,
  leading,
  trailing,
  index,
  onSelect,
  onHover,
  children,
}: FieldPopoverRowProps) {
  return (
    <div
      role='option'
      aria-selected={active ?? false}
      aria-disabled={disabled || undefined}
      aria-haspopup={nested || undefined}
      tabIndex={-1}
      className={styles.row}
      data-active={active || undefined}
      data-row-index={index}
      data-type='T060'
      onPointerMove={onHover}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) onSelect()
      }}
    >
      {leading}
      <span className={styles.label}>{children}</span>
      {trailing}
    </div>
  )
}

/** A caption over a group of rows. */
export function FieldPopoverHeading({ children }: { children: ReactNode }) {
  return (
    <div role='presentation' className={styles.heading} data-type='T052'>
      {children}
    </div>
  )
}

/** A quiet line in place of rows: nothing matches, or the list is still loading. */
export function FieldPopoverNote({ children }: { children: ReactNode }) {
  return (
    <div role='status' className={styles.note} data-type='T052'>
      {children}
    </div>
  )
}

/** Scrolls the active row of an open popup into view after the field's arrow keys move it. */
export function useActiveRowIntoView(open: boolean, activeIndex: number) {
  useEffect(() => {
    if (!open || activeIndex < 0) return
    const row = document.querySelector<HTMLElement>(
      `[role="listbox"] [data-row-index="${activeIndex}"]`
    )
    row?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])
}
