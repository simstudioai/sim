'use client'

import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type ScrollEdgeFadeVariant = 'action' | 'compact' | 'panel'

export interface ScrollEdgeFadeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Edge where the fade is anchored. */
  position: 'top' | 'bottom'
  /** Whether overflow currently exists beyond this edge. */
  visible?: boolean
  /** Density of the scroll surface that owns the fade. */
  variant?: ScrollEdgeFadeVariant
}

/**
 * Progressive edge blur for scrollable EMCN surfaces.
 *
 * @remarks
 * Set `--scroll-edge-fade-surface` on a parent when the surface differs from
 * `--bg`. The compact variant is sized for menus, panel is for full-height
 * catalog and resource surfaces, and action protects a floating footer CTA.
 */
export function ScrollEdgeFade({
  className,
  position,
  visible = true,
  variant = 'panel',
  ...props
}: ScrollEdgeFadeProps) {
  const isTop = position === 'top'
  const isAction = variant === 'action'

  return (
    <div
      aria-hidden='true'
      className={cn(
        'pointer-events-none absolute inset-x-0 z-10 select-none transition-opacity ease-out motion-reduce:transition-none',
        isTop ? 'top-0' : 'bottom-0',
        variant === 'compact'
          ? 'h-3 duration-150'
          : isAction
            ? 'h-20 duration-200'
            : 'h-12 duration-200',
        visible ? 'opacity-100' : 'opacity-0',
        className
      )}
      data-scroll-edge-fade={position}
      data-scroll-edge-fade-variant={variant}
      {...props}
    >
      <div
        className={cn(
          'absolute inset-0',
          isAction ? 'backdrop-blur-[4px]' : 'backdrop-blur-[1px]',
          isTop
            ? '[-webkit-mask-image:linear-gradient(to_top,transparent_0%,black_72%,black_100%)] [mask-image:linear-gradient(to_top,transparent_0%,black_72%,black_100%)]'
            : '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_72%,black_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_72%,black_100%)]'
        )}
      />
      <div
        className={cn(
          'absolute inset-0',
          isAction ? 'backdrop-blur-[8px]' : 'backdrop-blur-[2px]',
          isTop
            ? '[-webkit-mask-image:linear-gradient(to_top,transparent_20%,black_100%)] [mask-image:linear-gradient(to_top,transparent_20%,black_100%)]'
            : '[-webkit-mask-image:linear-gradient(to_bottom,transparent_20%,black_100%)] [mask-image:linear-gradient(to_bottom,transparent_20%,black_100%)]'
        )}
      />
      <div
        className={cn(
          'absolute inset-0',
          isAction ? 'backdrop-blur-[16px]' : 'backdrop-blur-[4px]',
          isTop
            ? '[-webkit-mask-image:linear-gradient(to_top,transparent_55%,black_100%)] [mask-image:linear-gradient(to_top,transparent_55%,black_100%)]'
            : '[-webkit-mask-image:linear-gradient(to_bottom,transparent_55%,black_100%)] [mask-image:linear-gradient(to_bottom,transparent_55%,black_100%)]'
        )}
      />
      <div
        className={cn(
          'absolute inset-0',
          isAction
            ? isTop
              ? 'bg-[linear-gradient(to_top,transparent_0%,var(--scroll-edge-fade-surface,var(--bg))_28%)]'
              : 'bg-[linear-gradient(to_bottom,transparent_0%,var(--scroll-edge-fade-surface,var(--bg))_28%)]'
            : isTop
              ? 'bg-[linear-gradient(to_top,transparent_0%,transparent_12%,var(--scroll-edge-fade-surface,var(--bg))_100%)]'
              : 'bg-[linear-gradient(to_bottom,transparent_0%,transparent_12%,var(--scroll-edge-fade-surface,var(--bg))_100%)]'
        )}
      />
    </div>
  )
}
