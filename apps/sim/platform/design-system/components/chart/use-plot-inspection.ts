'use client'

import {
  type KeyboardEvent,
  type PointerEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

interface InspectionOptions {
  band?: boolean
  initialIndex?: number
}

export function usePlotInspection(
  count: number,
  { band = false, initialIndex }: InspectionOptions = {}
) {
  const [index, setIndex] = useState(initialIndex)
  const active = index !== undefined && index >= 0 && index < count ? index : undefined
  const tooltipId = useId()
  const tooltipAnchor = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const tip = tooltipAnchor.current
    const plot = tip?.parentElement
    if (!tip || !plot || active === undefined) return
    const ratio = band ? (active + 0.5) / count : count === 1 ? 0.5 : active / (count - 1)
    const place = () => {
      const box = plot.getBoundingClientRect()
      const marker = plot.querySelector('[data-plot-marker]')?.getBoundingClientRect()
      const x = marker ? marker.left + marker.width / 2 - box.left : ratio * box.width
      const width = tip.offsetWidth
      const gap = Number.parseFloat(getComputedStyle(tip).columnGap)
      const left = x + gap + width <= box.width ? x + gap : x - gap - width
      tip.style.left = `${Math.max(0, Math.min(box.width - width, left))}px`
    }
    const observer = new ResizeObserver(place)
    observer.observe(plot)
    observer.observe(tip)
    place()
    return () => observer.disconnect()
  }, [active, count, band])
  function clear() {
    setIndex(undefined)
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      clear()
      return
    }
    const next = {
      Home: 0,
      End: count - 1,
      ArrowLeft: Math.max(0, (active ?? 1) - 1),
      ArrowRight: Math.min(count - 1, (active ?? -1) + 1),
    }[event.key]
    if (next !== undefined && count) {
      event.preventDefault()
      setIndex(next)
    }
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!count || !bounds.width) return
    const position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    setIndex(
      band ? Math.min(count - 1, Math.floor(position * count)) : Math.round(position * (count - 1))
    )
  }
  return {
    active,
    tooltipId,
    tooltipAnchor,
    onKeyDown,
    onFocus: () => {
      if (count && active === undefined) setIndex(0)
    },
    onBlur: clear,
    onPointerMove,
    onPointerLeave: clear,
  }
}
