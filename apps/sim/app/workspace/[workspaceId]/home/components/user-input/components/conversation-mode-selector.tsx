'use client'

import { useState } from 'react'
import { ChipDropdown, Tooltip } from '@sim/emcn'
import { getConversationModes } from '@/app/workspace/[workspaceId]/home/components/user-input/utils/conversation-modes'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

interface ConversationModeSelectorProps {
  value: ChatRequestMode
  lookupSelected?: boolean
  onSearch?: () => void
  searchEnabled?: boolean
  onChange?: (mode: ChatRequestMode) => void
}

/** The same mode control and deployment gate on organization and workspace composers. */
export function ConversationModeSelector({
  value,
  searchEnabled = false,
  lookupSelected = false,
  onSearch,
  onChange,
}: ConversationModeSelectorProps) {
  const planEnabled = useFeatureFlag('mothership-plan-mode')
  const [open, setOpen] = useState(false)
  const options = onSearch
    ? [
        { value: 'agent', label: 'Build' },
        ...(planEnabled ? [{ value: 'plan', label: 'Plan' }] : []),
        ...(searchEnabled
          ? [
              { value: 'assistant', label: 'Ask' },
              { value: 'search', label: 'Search' },
            ]
          : []),
      ]
    : getConversationModes(searchEnabled, planEnabled)
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
            value={lookupSelected ? 'search' : value}
            disabled={!onChange}
            align='start'
            matchTriggerWidth={false}
            showSelectedCheck={false}
            onOpenChange={setOpen}
            onChange={(mode) => {
              if (mode === 'search' && searchEnabled && onSearch) {
                onSearch()
                return
              }
              if (mode === value && !lookupSelected) return
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
      {!open && (
        <Tooltip.Content side='top'>
          {onChange ? <Tooltip.Shortcut keys='⇧ Tab'>Select mode</Tooltip.Shortcut> : 'Select mode'}
        </Tooltip.Content>
      )}
    </Tooltip.Root>
  )
}
