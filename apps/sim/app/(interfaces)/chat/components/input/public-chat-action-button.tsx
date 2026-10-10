import { type ComponentProps, forwardRef } from 'react'
import { Button } from '@sim/emcn'

interface PublicChatActionButtonProps
  extends Omit<
    ComponentProps<typeof Button>,
    'variant' | 'size' | 'iconSize' | 'iconPadding' | 'className'
  > {
  variant: 'primary' | 'quiet'
  'aria-label': string
}

/** Public chat's circular composer action, retaining its primary and quiet palettes. */
export const PublicChatActionButton = forwardRef<HTMLButtonElement, PublicChatActionButtonProps>(
  (props, ref) => (
    <Button
      {...props}
      ref={ref}
      className='size-[44px] rounded-full bg-clip-content p-2 md:size-[28px] md:p-0'
    />
  )
)
PublicChatActionButton.displayName = 'PublicChatActionButton'
