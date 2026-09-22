import { type ComponentProps, forwardRef } from 'react'
import { Button } from '@sim/emcn'

interface CanvasControlButtonProps
  extends Omit<
    ComponentProps<typeof Button>,
    'variant' | 'size' | 'iconSize' | 'iconPadding' | 'shape' | 'className'
  > {
  active?: boolean
  'aria-label': string
}

export const CanvasControlButton = forwardRef<HTMLButtonElement, CanvasControlButtonProps>(
  ({ active = false, ...props }, ref) => (
    <Button {...props} ref={ref} variant={active ? 'active' : 'quiet'} iconSize='regular' />
  )
)

CanvasControlButton.displayName = 'CanvasControlButton'
