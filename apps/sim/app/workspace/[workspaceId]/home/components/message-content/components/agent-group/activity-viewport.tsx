'use client'

import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import { cn, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'

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
  const edges = useScrollEdges(ref, { enabled: !unbounded })

  useEffect(() => {
    if (unbounded) {
      stickToBottomRef.current = true
      return
    }
    const el = ref.current
    if (!el) return
    /** Upward input detaches auto-stick; reaching the bottom while scrolling down resumes it. */
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
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (unbounded || !isStreaming) return
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
    <div
      ref={ref}
      className={cn(
        'pr-2',
        !unbounded && 'scrollbar-hide max-h-[110px] overflow-y-auto',
        scrollFadeClass,
        (edges.top || edges.bottom) && 'py-1'
      )}
      {...scrollFadeAttributes(edges)}
    >
      {children}
    </div>
  )
}
