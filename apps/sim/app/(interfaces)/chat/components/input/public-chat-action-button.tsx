import { type ComponentProps, forwardRef } from 'react'
import { Button } from '@sim/emcn'

interface PublicChatActionButtonProps
  extends Omit<
    ComponentProps<typeof Button>,
    'variant' | 'size' | 'iconSize' | 'iconPadding' | 'className' | 'shape'
  > {
  variant: 'primary' | 'quiet'
  'aria-label': string
}

/** Public chat's circular composer action, retaining its primary and quiet palettes. */
export const PublicChatActionButton = forwardRef<HTMLButtonElement, PublicChatActionButtonProps>(
  (props, ref) => <Button {...props} ref={ref} iconSize='regular' shape='round' />
)
PublicChatActionButton.displayName = 'PublicChatActionButton'
