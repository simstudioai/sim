'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import styles from '@/platform/design-system/components/overflow-text/overflow-text.module.css'
import { Tooltip } from '@/platform/design-system/components/tooltip/tooltip'

interface OverflowTextProps {
  text: string
  fullValue?: string
  children?: ReactNode
}

export function OverflowText({ text, fullValue = text, children }: OverflowTextProps) {
  const viewport = useRef<HTMLSpanElement>(null)
  const content = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)
  const [insideControl, setInsideControl] = useState(false)

  useEffect(() => {
    const outer = viewport.current
    const inner = content.current
    if (!outer || !inner) return
    setInsideControl(Boolean(outer.closest('button, a[href], [role=button], [role=tab]')))
    const measure = () =>
      setClipped(inner.getBoundingClientRect().width > outer.getBoundingClientRect().width)
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    observer.observe(inner)
    measure()
    return () => observer.disconnect()
  }, [])

  const shortened = text !== fullValue
  const showFullValue = clipped || shortened
  return (
    <span className={styles.overflowFrame}>
      <Tooltip label={fullValue} enabled={showFullValue} visualOnly>
        <span
          ref={viewport}
          className={styles.overflowText}
          data-axis='horizontal'
          data-clipped={clipped || undefined}
          tabIndex={showFullValue && !insideControl ? 0 : undefined}
        >
          <span
            ref={content}
            className={styles.overflowLabel}
            data-type={children == null ? 'T059' : undefined}
            aria-hidden={shortened || undefined}
          >
            {children ?? text}
          </span>
          {shortened && <span className={styles.accessibleLabel}>{fullValue}</span>}
        </span>
      </Tooltip>
    </span>
  )
}
