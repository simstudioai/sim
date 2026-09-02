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
import { useQueryState, useQueryStates } from 'nuqs'
import { usePostHog } from 'posthog-js/react'
import { captureEvent } from '@/lib/posthog/client'
import {
  CLEARED_SEARCH_FILTERS,
  resourceUrlKeys,
  searchFilterParsers,
  searchQueryParam,
} from '@/app/workspace/[workspaceId]/home/search-params'
import {
  MOTHERSHIP_MODES,
  type MothershipMode,
  useMothershipModeStore,
} from '@/stores/mothership-mode/store'

const MODE_LABELS: Record<MothershipMode, string> = {
  build: 'Build',
  search: 'Search',
  assistant: 'Assistant',
}

/**
 * The composer's Build / Search / Assistant switcher: a label-only `Chip` in its `round`
 * shape — chip chrome throughout (`--text-body` label, `--surface-hover` on
 * hover, no text-color shift), fully round to sit in the toolbar's row of
 * round controls — opening a menu that checks the active mode, as
 * `ChipDropdown` does.
 */
export const ModeSwitcher = memo(function ModeSwitcher() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const posthog = usePostHog()
  const mode = useMothershipModeStore((state) => state.mode)
  const setMode = useMothershipModeStore((state) => state.setMode)

  const [, setSearchQueryParam] = useQueryState(searchQueryParam.key, searchQueryParam.parser)
  const [, setSearchFilters] = useQueryStates(searchFilterParsers, resourceUrlKeys)

  /** Leaving Search drops the query from the URL, so a clean URL always means no search is showing. */
  const handleSelect = (next: MothershipMode) => {
    if (next === mode) return
    setMode(next)
    if (next !== 'search') {
      void setSearchQueryParam(null, { history: 'replace', scroll: false })
      void setSearchFilters(CLEARED_SEARCH_FILTERS, { history: 'replace', scroll: false })
    }
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
