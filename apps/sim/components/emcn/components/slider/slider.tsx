'use client'

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/core/utils/cn'

export interface SliderProps extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {}

/**
 * EMCN Slider component built on Radix UI Slider primitive.
 * Styled to match the Switch component with thin track design.
 *
 * @example
 * ```tsx
 * <Slider value={[50]} onValueChange={setValue} min={0} max={100} step={10} />
 * ```
 */
const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ className, ...props }, ref) => (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        'relative flex w-full touch-none select-none items-center',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track className='relative h-[6px] w-full grow overflow-hidden rounded-[20px] bg-[var(--surface-12)] transition-colors'>
        <SliderPrimitive.Range className='absolute h-full bg-[var(--surface-12)]' />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className='block h-[14px] w-[14px] cursor-pointer rounded-full bg-[var(--text-primary)] shadow-sm transition-colors focus-visible:outline-none' />
    </SliderPrimitive.Root>
  )
)

Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
