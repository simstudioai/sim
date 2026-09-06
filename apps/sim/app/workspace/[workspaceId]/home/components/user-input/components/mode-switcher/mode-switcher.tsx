'use client'

import { memo } from 'react'
import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Check } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { captureEvent } from '@/lib/posthog/client'
import { useMothershipMode } from '@/app/workspace/[workspaceId]/home/hooks/use-mothership-mode'
import {
  MOTHERSHIP_MODES,
  type MothershipMode,
} from '@/app/workspace/[workspaceId]/home/search-params'

const MODE_LABELS: Record<MothershipMode, string> = {
  build: 'Build',
  search: 'Search',
  assistant: 'Assistant',
}

interface ModeSwitcherProps {
  onModeChange?: () => void
}

/**
 * The composer's Build / Search / Assistant switcher: a label-only `Chip` in its `round`
 * shape — chip chrome throughout (`--text-body` label, `--surface-hover` on
 * hover, no text-color shift), fully round to sit in the toolbar's row of
 * round controls — opening a menu that checks the active mode, as
 * `ChipDropdown` does.
 */
export const ModeSwitcher = memo(function ModeSwitcher({ onModeChange }: ModeSwitcherProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const posthog = usePostHog()
  const [mode, setMode] = useMothershipMode()

  const handleSelect = (next: MothershipMode) => {
    if (next === mode) return
    onModeChange?.()
    void setMode(next)
    captureEvent(posthog, 'chat_mode_changed', { workspace_id: workspaceId, mode: next })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip shape='round' aria-label={`Mode: ${MODE_LABELS[mode]}`}>
          {MODE_LABELS[mode]}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {MOTHERSHIP_MODES.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => handleSelect(option)}>
            <DropdownMenuItemLabel label={MODE_LABELS[option]} />
            {option === mode && <Check className='!ml-auto !size-[16px]' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
