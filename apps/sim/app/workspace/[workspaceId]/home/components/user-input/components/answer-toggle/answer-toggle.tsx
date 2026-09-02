'use client'

import { memo } from 'react'
import { Chip, Tooltip } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { captureEvent } from '@/lib/posthog/client'
import { useMothershipModeStore } from '@/stores/mothership-mode/store'

/**
 * Search mode's Answer toggle: off, a query lists the matching documents; on,
 * Sim answers the question from those sources and may use the person's
 * connected tools. A label-only round `Chip` in its selected state while on,
 * sitting beside the mode switcher in the toolbar's row of round controls.
 */
export const AnswerToggle = memo(function AnswerToggle() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const posthog = usePostHog()
  const mode = useMothershipModeStore((state) => state.mode)
  const answer = useMothershipModeStore((state) => state.answer)
  const setAnswer = useMothershipModeStore((state) => state.setAnswer)

  if (mode !== 'search') return null

  const handleToggle = () => {
    setAnswer(!answer)
    captureEvent(posthog, 'chat_answer_toggled', { workspace_id: workspaceId, enabled: !answer })
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Chip shape='round' active={answer} aria-pressed={answer} onClick={handleToggle}>
          Answer
        </Chip>
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>
        {answer
          ? 'Sim answers from your sources and can use your tools'
          : 'List matching documents'}
      </Tooltip.Content>
    </Tooltip.Root>
  )
})
