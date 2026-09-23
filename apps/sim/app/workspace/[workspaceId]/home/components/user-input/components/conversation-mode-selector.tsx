'use client'

import { useState } from 'react'
import { ChipDropdown, cn, Tooltip } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'

interface ConversationModeSelectorProps {
  value: ChatRequestMode
  searchEnabled?: boolean
  onChange?: (mode: ChatRequestMode) => void
}

/** The same mode control and deployment gate on organization and workspace composers. */
export function ConversationModeSelector({
  value,
  searchEnabled = false,
  onChange,
}: ConversationModeSelectorProps) {
  const planEnabled = useDeploymentShape().features.planMode === true
  const [open, setOpen] = useState(false)
  const search = value === 'assistant'
  const options = [
    ...(searchEnabled ? [{ value: 'assistant', label: 'Search' }] : []),
    { value: 'agent', label: 'Build' },
    ...(planEnabled ? [{ value: 'plan', label: 'Plan' }] : []),
  ]
  if (options.length < 2) return null
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className={cn('inline-flex shrink-0', search && '-mx-2')}>
          <ChipDropdown
            variant='default'
            className='border-0'
            iconOnly={search}
            leftIcon={search ? Search : undefined}
            aria-label='Conversation mode'
            options={options}
            value={value}
            disabled={!onChange}
            align='start'
            matchTriggerWidth={false}
            showSelectedCheck={false}
            onOpenChange={setOpen}
            onChange={(mode) => {
              if (mode === value) return
              if (
                mode === 'agent' ||
                (mode === 'assistant' && searchEnabled) ||
                (mode === 'plan' && planEnabled)
              )
                onChange?.(mode)
            }}
          />
        </span>
      </Tooltip.Trigger>
      {!open && <Tooltip.Content side='top'>Select mode</Tooltip.Content>}
    </Tooltip.Root>
  )
}
