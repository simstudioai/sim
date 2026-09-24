import type { ComponentProps } from 'react'
import { forwardRef } from 'react'
import { Button } from '@sim/emcn'

interface CanvasControlButtonProps
  extends Omit<
    ComponentProps<typeof Button>,
    'variant' | 'size' | 'iconSize' | 'iconPadding' | 'shape' | 'className'
  > {
  active?: boolean
  'aria-label': string
}

/** Square action in the canvas navigation toolbar. */
export const CanvasControlButton = forwardRef<HTMLButtonElement, CanvasControlButtonProps>(
  ({ active = false, ...props }, ref) => (
    <Button {...props} ref={ref} variant={active ? 'active' : 'ghost-hover'} iconSize='regular' />
  )
)

CanvasControlButton.displayName = 'CanvasControlButton'
