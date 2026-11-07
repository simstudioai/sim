'use client'

import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { autoUpdate, computePosition, flip, shift } from '@floating-ui/dom'
import { createPortal } from 'react-dom'
import styles from '#emcn/components/tooltip/tooltip.module.css'

const TOOLTIP_OPEN = 'sim-emcn-tooltip-open'

interface TooltipProps {
  label: string
  enabled?: boolean
  visualOnly?: boolean
  panel?: ReactNode
  /** Make a native disabled control's explanation reachable without enabling the control. */
  disabledControl?: boolean
  children: ReactElement
}

export function Tooltip({
  label,
  enabled = true,
  visualOnly,
  panel,
  disabledControl,
  children,
}: TooltipProps) {
  const host = useRef<HTMLSpanElement>(null)
  const floating = useRef<HTMLSpanElement>(null)
  const id = useId()
  const [target, setTarget] = useState<Element | null>(null)
  const hasPanel = Boolean(panel)
  const child = isValidElement<{
    'aria-describedby'?: string
    'aria-label'?: string
    'aria-labelledby'?: string
  }>(children)
    ? children
    : undefined
  const description = enabled && !visualOnly && (target || disabledControl) ? id : undefined

  function show() {
    const trigger = host.current
    if (enabled && trigger && !trigger.querySelector('[aria-haspopup][aria-expanded="true"]'))
      setTarget(trigger.closest('dialog[open]') ?? trigger.closest('[data-emcn]'))
  }

  useEffect(() => {
    const anchor = host.current
    const enclosing = anchor?.closest('button, a[href], [role=button], [role=tab]')
    if (!anchor || !enclosing || !enabled) return
    const focus = () => setTarget(anchor.closest('dialog[open]') ?? anchor.closest('[data-emcn]'))
    const blur = () => setTarget(null)
    enclosing.addEventListener('focus', focus)
    enclosing.addEventListener('blur', blur)
    return () => {
      enclosing.removeEventListener('focus', focus)
      enclosing.removeEventListener('blur', blur)
    }
  }, [enabled])

  useLayoutEffect(() => {
    const anchor = host.current
    const tip = floating.current
    if (!anchor || !tip || !target || !enabled) return
    let active = true
    const stop = autoUpdate(anchor, tip, async () => {
      const { x, y } = await computePosition(anchor, tip, {
        strategy: 'fixed',
        placement: hasPanel ? 'bottom-end' : 'top',
        middleware: [flip(), shift()],
      })
      if (active) {
        tip.style.left = `${x}px`
        tip.style.top = `${y}px`
        tip.dataset.positioned = ''
      }
    })
    function dismiss(event: KeyboardEvent) {
      if (event.key === 'Escape') setTarget(null)
    }
    const owner = anchor.ownerDocument
    const dismissPrevious = () => setTarget(null)
    owner.dispatchEvent(new Event(TOOLTIP_OPEN))
    owner.addEventListener(TOOLTIP_OPEN, dismissPrevious)
    owner.addEventListener('keydown', dismiss)
    return () => {
      active = false
      stop()
      owner.removeEventListener(TOOLTIP_OPEN, dismissPrevious)
      owner.removeEventListener('keydown', dismiss)
    }
  }, [target, enabled, hasPanel])

  return (
    <span
      ref={host}
      className={styles.tooltipHost}
      data-disabled-control={disabledControl || undefined}
      tabIndex={disabledControl && enabled ? 0 : undefined}
      aria-label={disabledControl ? child?.props['aria-label'] : undefined}
      aria-labelledby={disabledControl ? child?.props['aria-labelledby'] : undefined}
      aria-describedby={disabledControl && enabled ? id : undefined}
      onFocus={show}
      onPointerEnter={show}
      onPointerDown={
        disabledControl && enabled
          ? (event) => {
              if (event.pointerType === 'touch') event.currentTarget.focus()
            }
          : undefined
      }
      onBlur={() => setTarget(null)}
      onClickCapture={disabledControl ? show : hasPanel ? undefined : () => setTarget(null)}
      onPointerLeave={(event) => {
        if (event.relatedTarget instanceof Node && floating.current?.contains(event.relatedTarget))
          return
        if (!event.currentTarget.matches(':focus-within')) setTarget(null)
      }}
    >
      {child
        ? cloneElement(child, {
            'aria-describedby':
              [child.props['aria-describedby'], description].filter(Boolean).join(' ') || undefined,
          })
        : children}
      {enabled && disabledControl && !target && (
        <span id={id} data-visually-hidden=''>
          {label}
        </span>
      )}
      {enabled &&
        target &&
        createPortal(
          <span
            ref={floating}
            id={id}
            role='tooltip'
            aria-hidden={visualOnly || undefined}
            className={styles[hasPanel ? 'tooltipPanel' : 'tooltip']}
            data-type={hasPanel ? undefined : 'T050'}
            data-elevation={hasPanel ? undefined : 'tooltip'}
            onPointerLeave={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                host.current?.contains(event.relatedTarget)
              )
                return
              if (!host.current?.matches(':focus-within')) setTarget(null)
            }}
          >
            {panel ?? <span className={styles.label}>{label}</span>}
          </span>,
          target
        )}
    </span>
  )
}
