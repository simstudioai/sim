'use client'

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/core/utils/cn'

/**
 * Track height and thumb size per slider size variant.
 */
const SLIDER_SIZES = {
  sm: { track: 'h-1', thumb: 'h-2.5 w-2.5', hitArea: 'before:inset-[-12px]' },
  md: { track: 'h-[6px]', thumb: 'h-[14px] w-[14px]', hitArea: 'before:inset-[-15px]' },
  lg: { track: 'h-2', thumb: 'h-[18px] w-[18px]', hitArea: 'before:inset-[-15px]' },
} as const

type SliderSize = keyof typeof SLIDER_SIZES

export interface SliderProps extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /** Size variant of the slider */
  size?: SliderSize
}

/**
 * EMCN Slider component built on Radix UI Slider primitive.
 * Styled to match the Switch component with thin track design.
 *
 * @example
 * ```tsx
 * // Default size
 * <Slider value={[50]} onValueChange={setValue} min={0} max={100} step={10} />
 *
 * // Small size for compact UIs
 * <Slider size="sm" value={[50]} onValueChange={setValue} />
 *
 * // Large size for prominent controls
 * <Slider size="lg" value={[50]} onValueChange={setValue} />
 * ```
 */
const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ className, disabled, size = 'md', ...props }, ref) => {
    const sizeConfig = SLIDER_SIZES[size]

    return (
      <SliderPrimitive.Root
        ref={ref}
        disabled={disabled}
        className={cn(
          'relative flex w-full touch-none select-none items-center',
          'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
          className
        )}
        {...props}
      >
        <SliderPrimitive.Track
          className={cn(
            'relative w-full grow overflow-hidden rounded-[20px] bg-[var(--border-1)] transition-colors',
            sizeConfig.track
          )}
        >
          <SliderPrimitive.Range className='absolute h-full bg-[var(--text-primary)]' />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className={cn(
            'relative block cursor-pointer rounded-full bg-[var(--text-primary)] shadow-sm transition-colors before:absolute before:content-[""] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--text-muted)_30%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)]',
            sizeConfig.thumb,
            sizeConfig.hitArea
          )}
        />
      </SliderPrimitive.Root>
    )
  }
)

Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
