'use client'

import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@sim/emcn/lib/cn'
import { CanvasTooltip } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/canvas-tooltip'
import { CodeHoverCard } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/code-hover-card'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/overflow-span.module.css'
import { isTextClipped } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/text-clip'
import type { CodePreview } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/types'

interface OverflowSpanProps {
  value: string
  /** Layout and typography only; the renderer owns its overflow treatment. */
  className: string
  /** Rich content shown instead of the plain value when this is clipped code. */
  codePreview?: CodePreview
  /**
   * Decorated rendering of `value` — the same characters, wrapped. Used to mark
   * a search hit inside a name without letting the decoration reach the
   * tooltip, which stays plain `value` so it can never leak markup or drift
   * from the text being truncated.
   */
  children?: ReactNode
}

/**
 * Truncated span that reveals its full value in a floating tooltip when — and
 * only when — the text is actually clipped. Never use a native `title`
 * attribute here: on the canvas it pops the browser's raw, unstyled tooltip
 * with the full untruncated value (including raw code/JSON) over the graph.
 */
export function OverflowSpan({ value, className, codePreview, children }: OverflowSpanProps) {
  if (codePreview) {
    return (
      <CodeHoverCard preview={codePreview} className={cn(styles.truncate, className)}>
        {children ?? value}
      </CodeHoverCard>
    )
  }

  return (
    <OverflowText label={value} className={className}>
      {children}
    </OverflowText>
  )
}

const overflowMeasureByElement = new WeakMap<Element, () => void>()
const observedOverflowElements = new Set<Element>()
let sharedOverflowObserver: ResizeObserver | null = null
let sharedOverflowFontSet: FontFaceSet | null = null

function measureObservedOverflow() {
  for (const element of observedOverflowElements) overflowMeasureByElement.get(element)?.()
}

function observeOverflowFontChanges() {
  if (typeof document === 'undefined' || !document.fonts || sharedOverflowFontSet) return
  const fontSet = document.fonts
  sharedOverflowFontSet = fontSet
  fontSet.addEventListener('loadingdone', measureObservedOverflow)
  fontSet.addEventListener('loadingerror', measureObservedOverflow)
  void fontSet.ready.then(() => {
    if (sharedOverflowFontSet === fontSet) measureObservedOverflow()
  })
}

function unobserveOverflowFontChanges() {
  sharedOverflowFontSet?.removeEventListener('loadingdone', measureObservedOverflow)
  sharedOverflowFontSet?.removeEventListener('loadingerror', measureObservedOverflow)
  sharedOverflowFontSet = null
}

/** One ResizeObserver for every clipped label on the canvas, as the legacy label used. */
function observeOverflow(element: Element, measure: () => void): boolean {
  overflowMeasureByElement.set(element, measure)
  observedOverflowElements.add(element)
  observeOverflowFontChanges()
  if (typeof ResizeObserver === 'undefined') return false
  sharedOverflowObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) overflowMeasureByElement.get(entry.target)?.()
  })
  sharedOverflowObserver.observe(element)
  return true
}

function unobserveOverflow(element: Element | null) {
  if (!element) return
  sharedOverflowObserver?.unobserve(element)
  overflowMeasureByElement.delete(element)
  observedOverflowElements.delete(element)
  if (observedOverflowElements.size === 0) {
    sharedOverflowObserver?.disconnect()
    sharedOverflowObserver = null
    unobserveOverflowFontChanges()
  }
}

/**
 * Tracks whether an element's text is horizontally clipped, re-measuring when `measurementKey` or
 * loaded fonts change and as the element resizes.
 */
function useIsOverflowing<T extends HTMLElement>(measurementKey?: unknown) {
  const [isOverflowing, setIsOverflowing] = useState(false)
  const nodeRef = useRef<T | null>(null)

  const measure = useCallback(() => {
    const element = nodeRef.current
    if (element) setIsOverflowing(isTextClipped(element))
  }, [])

  const ref = useCallback(
    (node: T | null) => {
      unobserveOverflow(nodeRef.current)
      nodeRef.current = node
      if (!node) return
      measure()
      observeOverflow(node, measure)
    },
    [measure]
  )

  useEffect(() => {
    const element = nodeRef.current
    if (!element) return undefined
    const usesResizeObserver = observeOverflow(element, measure)
    if (!usesResizeObserver) window.addEventListener('resize', measure)
    return () => {
      if (!usesResizeObserver) window.removeEventListener('resize', measure)
      unobserveOverflow(element)
    }
  }, [measure])

  useLayoutEffect(() => {
    measure()
  }, [measure, measurementKey])

  return { ref, isOverflowing }
}

interface OverflowTextProps {
  /** Full text shown in the tooltip and used as the default visible content. */
  label: string
  /** Decorated rendering of `label`; the tooltip always keeps the plain label. */
  children?: ReactNode
  /** Layout and typography only; truncation and fade chrome are owned here. */
  className?: string
}

/**
 * The legacy single-line label painted on the card: clipped without an ellipsis, faded at its end
 * only while it overflows, with the full value in a tooltip while it is clipped.
 */
const OverflowText = memo(function OverflowText({ label, children, className }: OverflowTextProps) {
  const { ref, isOverflowing } = useIsOverflowing<HTMLSpanElement>(children ?? label)
  return (
    <CanvasTooltip
      content={label}
      decorative
      canShow={(element) => label.length > 0 && isTextClipped(element)}
    >
      <span
        ref={ref}
        data-overflow-text=''
        className={cn(className, styles.clip, isOverflowing && styles.fade)}
      >
        {children ?? label}
      </span>
    </CanvasTooltip>
  )
})
