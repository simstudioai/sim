import { type ComponentProps, forwardRef } from 'react'
import { Button, chipHoverSurfaceClass, cn } from '@sim/emcn'

interface CanvasControlButtonProps
  extends Omit<
    ComponentProps<typeof Button>,
    'variant' | 'size' | 'iconSize' | 'iconPadding' | 'className'
  > {
  active?: boolean
  'aria-label': string
}

/** Fixed-size action in the canvas navigation toolbar. */
export const CanvasControlButton = forwardRef<HTMLButtonElement, CanvasControlButtonProps>(
  ({ active = false, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      variant={active ? 'active' : 'ghost'}
      className={cn('size-[28px] rounded-sm p-0', !active && chipHoverSurfaceClass)}
    />
  )
)

CanvasControlButton.displayName = 'CanvasControlButton'
