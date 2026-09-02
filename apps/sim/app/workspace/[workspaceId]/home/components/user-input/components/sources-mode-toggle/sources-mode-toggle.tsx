'use client'

import { memo } from 'react'
import { Chip, Tooltip } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { captureEvent } from '@/lib/posthog/client'
import { useMothershipModeStore } from '@/stores/mothership-mode/store'

const OPTIONS = [
  {
    assistant: false,
    label: 'Search',
    hint: 'Enterprise search: list the documents that match, from every source you can read',
  },
  {
    assistant: true,
    label: 'Assistant',
    hint: 'Answer in natural language from your sources, citing them, using your tools when needed',
  },
] as const

/**
 * Sources mode's two ways to use the sources, as a pair of round chips that
 * act as one radio group: Search lists the matching documents; Assistant
 * answers the question in natural language from them. The selected chip is
 * the one in its selected state, so both choices are always named and the
 * current one is never in doubt.
 */
export const SourcesModeToggle = memo(function SourcesModeToggle() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const posthog = usePostHog()
  const mode = useMothershipModeStore((state) => state.mode)
  const assistant = useMothershipModeStore((state) => state.assistant)
  const setAssistant = useMothershipModeStore((state) => state.setAssistant)

  if (mode !== 'search') return null

  const select = (next: boolean) => {
    if (next === assistant) return
    setAssistant(next)
    captureEvent(posthog, 'chat_sources_mode_changed', {
      workspace_id: workspaceId,
      mode: next ? 'assistant' : 'search',
    })
  }

  return (
    <div role='radiogroup' aria-label='How to use your sources' className='flex items-center gap-1'>
      {OPTIONS.map((option) => (
        <Tooltip.Root key={option.label}>
          <Tooltip.Trigger asChild>
            <Chip
              shape='round'
              role='radio'
              aria-checked={option.assistant === assistant}
              active={option.assistant === assistant}
              onClick={() => select(option.assistant)}
            >
              {option.label}
            </Chip>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>{option.hint}</Tooltip.Content>
        </Tooltip.Root>
      ))}
    </div>
  )
})
