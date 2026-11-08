'use client'

import {
  cloneElement,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/canvas-tooltip.module.css'
import {
  FLOATING_OPEN_EVENT,
  floatingContainer,
  useFloatingPosition,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/floating-layer'

interface TooltipTriggerProps {
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void
  onFocus?: (event: FocusEvent<HTMLElement>) => void
  onBlur?: (event: FocusEvent<HTMLElement>) => void
  'aria-describedby'?: string
}

interface CanvasTooltipProps {
  /** The tooltip text, or structured lines. */
  content: ReactNode
  /** Checked on each hover or focus; the tooltip opens only when it passes (e.g. clipped text). */
  canShow?: (trigger: HTMLElement) => boolean
  /** A decorative tooltip repeats visible text, so it stays out of the accessibility tree. */
  decorative?: boolean
  /** The single trigger element; it must forward pointer and focus handlers to its DOM node. */
  children: ReactElement<TooltipTriggerProps>
}

/**
 * The card's tooltip: the EMCN tooltip surface (its type role, elevation, ink and radius), opened by
 * hovering or keyboard-focusing the trigger itself. EMCN's `Tooltip` wraps its trigger in a flex
 * host and also opens whenever the nearest button-like ancestor takes focus; on the canvas the card
 * is that ancestor and clicking it focuses it, and the host would re-flow the card's rows. So the
 * card keeps its own markup and only borrows the popup.
 */
export function CanvasTooltip({ content, canShow, decorative, children }: CanvasTooltipProps) {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null)
  const popupRef = useRef<HTMLSpanElement>(null)
  const id = useId()
  const hide = useCallback(() => setTrigger(null), [])

  useFloatingPosition(trigger, popupRef, { placement: 'top', onAnchorLost: hide })

  useEffect(() => {
    if (!trigger) return
    const owner = trigger.ownerDocument
    owner.dispatchEvent(new Event(FLOATING_OPEN_EVENT))
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    owner.addEventListener(FLOATING_OPEN_EVENT, hide)
    owner.addEventListener('keydown', onKeyDown)
    return () => {
      owner.removeEventListener(FLOATING_OPEN_EVENT, hide)
      owner.removeEventListener('keydown', onKeyDown)
    }
  }, [trigger, hide])

  const show = (target: HTMLElement) => {
    if (canShow && !canShow(target)) return
    setTrigger(target)
  }
  const props = children.props

  return (
    <>
      {cloneElement(children, {
        'aria-describedby':
          [props['aria-describedby'], trigger && !decorative ? id : undefined]
            .filter(Boolean)
            .join(' ') || undefined,
        onPointerEnter: (event: PointerEvent<HTMLElement>) => {
          props.onPointerEnter?.(event)
          if (event.pointerType !== 'touch') show(event.currentTarget)
        },
        onPointerLeave: (event: PointerEvent<HTMLElement>) => {
          props.onPointerLeave?.(event)
          hide()
        },
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
          props.onPointerDown?.(event)
          hide()
        },
        onFocus: (event: FocusEvent<HTMLElement>) => {
          props.onFocus?.(event)
          if (event.currentTarget.matches(':focus-visible')) show(event.currentTarget)
        },
        onBlur: (event: FocusEvent<HTMLElement>) => {
          props.onBlur?.(event)
          hide()
        },
      })}
      {trigger &&
        createPortal(
          <span
            ref={popupRef}
            id={id}
            role={decorative ? undefined : 'tooltip'}
            aria-hidden={decorative || undefined}
            className={styles.tooltip}
            data-type='T050'
            data-elevation='tooltip'
          >
            <span className={styles.content}>{content}</span>
          </span>,
          floatingContainer(trigger)
        )}
    </>
  )
}
