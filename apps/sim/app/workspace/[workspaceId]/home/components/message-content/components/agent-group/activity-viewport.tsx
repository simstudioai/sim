'use client'

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'

interface ActivityViewportProps {
  children: ReactNode
  isStreaming: boolean
  /** A nested blocking interaction must not be clipped by this ancestor's log viewport. */
  unbounded?: boolean
}

const BOTTOM_STICK_THRESHOLD_PX = 8

export function ActivityViewport({
  children,
  isStreaming,
  unbounded = false,
}: ActivityViewportProps) {
  const ref = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const stickToBottomRef = useRef(true)
  const prevScrollTopRef = useRef(0)
  const [hasOverflow, setHasOverflow] = useState(false)

  useEffect(() => {
    if (unbounded) {
      stickToBottomRef.current = true
      return
    }
    const el = ref.current
    if (!el) return
    // Upward user input detaches auto-stick; a downward scroll reaching the
    // bottom re-attaches it (a small upward flick can't re-stick itself).
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stickToBottomRef.current = false
    }
    const handleScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distance < BOTTOM_STICK_THRESHOLD_PX && el.scrollTop > prevScrollTopRef.current) {
        stickToBottomRef.current = true
      }
      prevScrollTopRef.current = el.scrollTop
    }
    el.addEventListener('wheel', handleWheel, { passive: true })
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('scroll', handleScroll)
    }
  }, [unbounded])

  useLayoutEffect(() => {
    const el = ref.current
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (unbounded) {
      setHasOverflow(false)
      return
    }
    if (el) {
      const next = el.scrollHeight > el.clientHeight
      setHasOverflow((prev) => (prev === next ? prev : next))
    }
    if (!isStreaming) return
    const tick = () => {
      const node = ref.current
      if (!node || !stickToBottomRef.current) {
        rafRef.current = null
        return
      }
      const target = node.scrollHeight - node.clientHeight
      const gap = target - node.scrollTop
      if (gap < 1) {
        rafRef.current = null
        return
      }
      node.scrollTop = node.scrollTop + Math.max(1, gap * 0.18)
      rafRef.current = window.requestAnimationFrame(tick)
    }
    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  })

  return (
    <div className='relative'>
      <div
        ref={ref}
        className={cn(
          'pr-2',
          !unbounded && 'scrollbar-hide max-h-[110px] overflow-y-auto',
          hasOverflow && 'py-1'
        )}
      >
        {children}
      </div>
      {!unbounded && hasOverflow && (
        <>
          <div className='pointer-events-none absolute top-0 right-2 left-0 h-3 bg-linear-to-b from-[var(--bg)] to-transparent' />
          <div className='pointer-events-none absolute right-2 bottom-0 left-0 h-3 bg-linear-to-t from-[var(--bg)] to-transparent' />
        </>
      )}
    </div>
  )
}
