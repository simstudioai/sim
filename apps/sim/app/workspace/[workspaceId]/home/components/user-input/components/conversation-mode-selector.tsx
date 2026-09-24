'use client'

import { useState } from 'react'
import { ChipDropdown, Tooltip } from '@sim/emcn'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

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
  const planEnabled = useFeatureFlag('mothership-plan-mode')
  const [open, setOpen] = useState(false)
  const options = [
    ...(searchEnabled ? [{ value: 'assistant', label: 'Ask' }] : []),
    { value: 'agent', label: 'Build' },
    ...(planEnabled ? [{ value: 'plan', label: 'Plan' }] : []),
  ]
  if (options.length < 2) return null
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className='inline-flex shrink-0'>
          <ChipDropdown
            variant='ghost'
            shape='round'
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
