'use client'

import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { autoUpdate, computePosition, flip, shift } from '@floating-ui/dom'
import { Slot } from '@radix-ui/react-slot'
import { createPortal } from 'react-dom'
import styles from '@/platform/design-system/components/components.module.css'

interface TooltipProps {
  label: string
  enabled?: boolean
  visualOnly?: boolean
  panel?: ReactNode
  children: ReactElement
}

export function Tooltip({ label, enabled = true, visualOnly, panel, children }: TooltipProps) {
  const host = useRef<HTMLSpanElement>(null)
  const floating = useRef<HTMLSpanElement>(null)
  const id = useId()
  const [target, setTarget] = useState<Element | null>(null)
  const hasPanel = Boolean(panel)

  function show() {
    const trigger = host.current
    if (enabled && trigger)
      setTarget(trigger.closest('dialog[open]') ?? trigger.closest('[data-platform-ui]'))
  }

  useEffect(() => {
    const anchor = host.current
    const enclosing = anchor?.closest('button, a[href], [role=button], [role=tab]')
    if (!anchor || !enclosing || !enabled) return
    const focus = () =>
      setTarget(anchor.closest('dialog[open]') ?? anchor.closest('[data-platform-ui]'))
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
      if (event.key === 'Escape') {
        event.preventDefault()
        setTarget(null)
      }
    }
    document.addEventListener('keydown', dismiss)
    return () => {
      active = false
      stop()
      document.removeEventListener('keydown', dismiss)
    }
  }, [target, enabled, hasPanel])

  return (
    <span
      ref={host}
      className={styles.tooltipHost}
      onFocus={show}
      onPointerEnter={show}
      onBlur={(event) => {
        if (!event.currentTarget.matches(':hover')) setTarget(null)
      }}
      onPointerLeave={(event) => {
        if (event.relatedTarget instanceof Node && floating.current?.contains(event.relatedTarget))
          return
        if (!event.currentTarget.matches(':focus-within')) setTarget(null)
      }}
    >
      <Slot aria-describedby={enabled && target && !visualOnly ? id : undefined}>{children}</Slot>
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
            {panel ?? label}
          </span>,
          target
        )}
    </span>
  )
}
