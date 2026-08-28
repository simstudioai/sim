'use client'

import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { cn } from '@sim/emcn'

const SCALE_EPSILON = 0.0001

interface FitScaleOptions {
  availableWidth: number
  availableHeight: number
  designWidth: number
  designHeight: number
  inset: number
  maxScale: number
}

export function calculateFitScale({
  availableWidth,
  availableHeight,
  designWidth,
  designHeight,
  inset,
  maxScale,
}: FitScaleOptions): number {
  if (
    availableWidth <= inset ||
    availableHeight <= inset ||
    designWidth <= 0 ||
    designHeight <= 0 ||
    maxScale <= 0
  ) {
    return 0
  }

  return Math.min(
    maxScale,
    (availableWidth - inset) / designWidth,
    (availableHeight - inset) / designHeight
  )
}

interface ResponsiveDesignStageProps {
  width: number
  height: number
  children: ReactNode
  className?: string
  contentClassName?: string
  inset?: number
  maxScale?: number
  align?: 'start' | 'center'
}

/**
 * Fits a fixed-size HTML design surface into its host without putting HTML in
 * SVG. `ResizeObserver` watches only the stable host box, and the scale is
 * written directly to the design surface so resizes do not rerender its React
 * subtree. CSS `zoom` keeps the surface in normal document layout and avoids
 * the fractional compositing drift caused by scaling a layer full of animated
 * descendants. The transform branch is a fallback for older browsers.
 */
export function ResponsiveDesignStage({
  width,
  height,
  children,
  className,
  contentClassName,
  inset = 0,
  maxScale = 1,
  align = 'center',
}: ResponsiveDesignStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    const surface = surfaceRef.current
    if (!host || !surface) return

    surface.style.width = `${width}px`
    surface.style.height = `${height}px`

    const supportsZoom = CSS.supports('zoom', '1')
    let appliedScale = -1

    const applyScale = (availableWidth: number, availableHeight: number) => {
      const scale = calculateFitScale({
        availableWidth,
        availableHeight,
        designWidth: width,
        designHeight: height,
        inset,
        maxScale,
      })
      if (scale === 0) {
        surface.style.opacity = '0'
        appliedScale = -1
        return
      }
      if (Math.abs(scale - appliedScale) < SCALE_EPSILON) return

      if (supportsZoom) {
        surface.style.zoom = String(scale)
        surface.style.transform = ''
      } else {
        surface.style.zoom = '1'
        surface.style.transform = `scale(${scale})`
      }
      surface.style.opacity = '1'
      appliedScale = scale
    }

    applyScale(host.clientWidth, host.clientHeight)

    const observer = new ResizeObserver(([entry]) => {
      applyScale(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(host)

    return () => observer.disconnect()
  }, [height, inset, maxScale, width])

  return (
    <div
      ref={hostRef}
      className={cn(
        'overflow-hidden [contain:content]',
        align === 'center' ? 'flex items-center justify-center' : 'relative',
        className
      )}
    >
      <div
        ref={surfaceRef}
        className={cn(
          'shrink-0 opacity-0',
          align === 'start' ? 'absolute top-0 left-0 origin-top-left' : 'origin-center',
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  )
}
