'use client'

import { type ComponentProps, forwardRef } from 'react'
import { Button, Tooltip } from '@sim/emcn'

interface WorkflowPreviewActionProps
  extends Omit<
    ComponentProps<typeof Button>,
    'variant' | 'size' | 'iconSize' | 'iconPadding' | 'type' | 'className'
  > {
  'aria-label': string
}

/** Solid corner action shared by embedded workflow previews. */
export const WorkflowPreviewAction = forwardRef<HTMLButtonElement, WorkflowPreviewActionProps>(
  ({ 'aria-label': label, ...props }, ref) => (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          {...props}
          ref={ref}
          type='button'
          aria-label={label}
          variant='ghost'
          iconSize='compact-fixed'
          className='absolute right-[6px] bottom-1.5 z-10 cursor-pointer border border-[var(--border)] bg-[var(--surface-2)] hover-hover:bg-[var(--surface-4)]'
        />
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>{label}</Tooltip.Content>
    </Tooltip.Root>
  )
)

WorkflowPreviewAction.displayName = 'WorkflowPreviewAction'
