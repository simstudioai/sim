'use client'

import { type ReactNode, useRef } from 'react'
import { IconButton } from '@/platform/design-system/components/button/button'
import styles from '@/platform/design-system/components/scroll-area/scroll-area.module.css'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

interface ScrollAreaProps {
  label: string
  axis?: 'vertical' | 'horizontal'
  arrows?: boolean
  hideScrollbar?: boolean
  startAtEnd?: boolean
  children: ReactNode
}

export function ScrollArea({
  label,
  axis = 'vertical',
  arrows = false,
  hideScrollbar = false,
  startAtEnd = false,
  children,
}: ScrollAreaProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const scrollRef = useScrollEdges(axis, { viewport, arrows, startAtEnd, tabStop: true })
  const region = (
    <div
      ref={scrollRef}
      className={styles.viewport}
      data-axis={axis}
      data-hide-scrollbar={arrows || hideScrollbar || undefined}
      role='region'
      aria-label={label}
    >
      <div className={styles.content}>{children}</div>
    </div>
  )
  if (!arrows) return region

  function move(direction: number) {
    const el = viewport.current
    if (!el) return
    const sign = window.getComputedStyle(el).direction === 'rtl' ? -1 : 1
    el.scrollBy({ left: direction * sign * el.clientWidth * 0.8 })
    el.focus({ preventScroll: true })
  }

  return (
    <div className={styles.shell}>
      <div className={styles.previous}>
        <IconButton label={`Scroll ${label} backward`} icon='I032' onClick={() => move(-1)} />
      </div>
      {region}
      <div className={styles.next}>
        <IconButton label={`Scroll ${label} forward`} icon='I032' onClick={() => move(1)} />
      </div>
    </div>
  )
}
