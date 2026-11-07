'use client'

import { type RefObject, useCallback } from 'react'

type ScrollAxis = 'vertical' | 'horizontal'
interface ScrollOptions<T> {
  viewport?: RefObject<T | null>
  tabStop?: boolean
  arrows?: boolean
  startAtEnd?: boolean
}

/** Measure the actual scrolling element, including portalled lists and editable fields. */
export function useScrollEdges<T extends HTMLElement>(
  axis: ScrollAxis = 'vertical',
  { viewport, tabStop, arrows, startAtEnd }: ScrollOptions<T> = {}
) {
  return useCallback(
    (element: T | null) => {
      if (!element) return
      if (viewport) viewport.current = element
      element.dataset.scrollAxis = axis
      let jump = startAtEnd
      const vertical = axis === 'vertical'
      function measure() {
        if (!element) return
        if (jump && element.clientHeight && element.clientWidth) {
          if (vertical) element.scrollTop = element.scrollHeight
          else element.scrollLeft = element.scrollWidth
          jump = false
        }
        const offset = vertical ? element.scrollTop : Math.abs(element.scrollLeft)
        const max = vertical
          ? element.scrollHeight - element.clientHeight
          : element.scrollWidth - element.clientWidth
        const fitsLane =
          arrows &&
          element.parentElement &&
          element.firstElementChild &&
          element.firstElementChild.scrollWidth <= element.parentElement.clientWidth + 1
        const start = !fitsLane && offset > 1
        const end = !fitsLane && offset < max - 1
        element.dataset.edges = start ? (end ? 'both' : 'start') : end ? 'end' : 'none'
        if (tabStop) element.tabIndex = start || end ? 0 : -1
      }
      const resize = new ResizeObserver(measure)
      resize.observe(element)
      if (arrows && element.parentElement) resize.observe(element.parentElement)
      const observedChildren = new Set<Element>()
      /** Only the rows that came or went, so a windowed list's scrolling stays cheap. */
      const syncChildren = () => {
        for (const child of observedChildren) {
          if (child.parentElement === element) continue
          resize.unobserve(child)
          observedChildren.delete(child)
        }
        for (const child of element.children) {
          if (observedChildren.has(child)) continue
          resize.observe(child)
          observedChildren.add(child)
        }
      }
      syncChildren()
      measure()
      let frame = 0
      /** A burst of changes costs one layout read. */
      const measureNextFrame = () => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(measure)
      }
      const content = new MutationObserver((records) => {
        if (records.some(({ type, target }) => type === 'childList' && target === element))
          syncChildren()
        measureNextFrame()
      })
      content.observe(element, { childList: true, subtree: true, characterData: true })
      const form =
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.form
          : null
      form?.addEventListener('reset', measureNextFrame)
      element.addEventListener('scroll', measure, { passive: true })
      element.addEventListener('input', measure)
      return () => {
        form?.removeEventListener('reset', measureNextFrame)
        cancelAnimationFrame(frame)
        content.disconnect()
        resize.disconnect()
        element.removeEventListener('scroll', measure)
        element.removeEventListener('input', measure)
        if (viewport) viewport.current = null
      }
    },
    [axis, viewport, tabStop, arrows, startAtEnd]
  )
}
