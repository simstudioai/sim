'use client'

import { type ComponentProps, forwardRef } from 'react'
import { OverlayActionButton, Tooltip } from '@sim/emcn'

interface WorkflowPreviewActionProps
  extends Omit<
    ComponentProps<typeof OverlayActionButton>,
    'size' | 'type' | 'className' | 'shape'
  > {
  'aria-label': string
}

/** Overlay corner action shared by embedded workflow previews. */
export const WorkflowPreviewAction = forwardRef<HTMLButtonElement, WorkflowPreviewActionProps>(
  ({ 'aria-label': label, ...props }, ref) => (
    <Tooltip.Root preferAbove>
      <Tooltip.Trigger asChild>
        <OverlayActionButton
          {...props}
          ref={ref}
          type='button'
          aria-label={label}
          size='md'
          className='absolute right-[6px] bottom-1.5 z-10'
        />
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip.Root>
  )
)

WorkflowPreviewAction.displayName = 'WorkflowPreviewAction'
