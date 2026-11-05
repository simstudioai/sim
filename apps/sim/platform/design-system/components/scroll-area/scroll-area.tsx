'use client'

import { type ReactNode, useEffect, useRef } from 'react'
import { IconButton } from '@/platform/design-system/components/button/button'
import styles from '@/platform/design-system/components/scroll-area/scroll-area.module.css'

interface ScrollAreaProps {
  label: string
  axis?: 'vertical' | 'horizontal'
  arrows?: boolean
  startAtEnd?: boolean
  children: ReactNode
}

export function ScrollArea({
  label,
  axis = 'vertical',
  arrows = false,
  startAtEnd = false,
  children,
}: ScrollAreaProps) {
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = viewport.current
    const content = el?.firstElementChild
    if (!el || !content) return
    let positionAtEnd = startAtEnd
    function measure() {
      if (!el || !content) return
      const vertical = axis === 'vertical'
      if (positionAtEnd && el.clientHeight && el.clientWidth) {
        if (vertical) el.scrollTop = el.scrollHeight
        else el.scrollLeft = el.scrollWidth
        positionAtEnd = false
      }
      const offset = vertical ? el.scrollTop : Math.abs(el.scrollLeft)
      const limit = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
      el.tabIndex = limit > 1 ? 0 : -1
      const start = offset > 1
      const fitsLane =
        arrows && el.parentElement && content.scrollWidth <= el.parentElement.clientWidth + 1
      if (fitsLane) {
        el.dataset.edges = 'none'
        el.tabIndex = -1
        return
      }
      const end = offset < limit - 1
      el.dataset.edges = start ? (end ? 'both' : 'start') : end ? 'end' : 'none'
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observer.observe(content)
    if (arrows && el.parentElement) observer.observe(el.parentElement)
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', measure)
    }
  }, [axis, arrows, startAtEnd])
  const region = (
    <div
      ref={viewport}
      className={styles.viewport}
      data-axis={axis}
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
