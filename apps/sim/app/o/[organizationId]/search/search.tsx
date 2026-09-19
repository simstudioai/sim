'use client'

import { useEffect, useRef, useState } from 'react'
import { ComposerActionButton, toast } from '@sim/emcn'
import { ArrowUp } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { organizationRoutes } from '@/lib/navigation/paths'
import { SearchInputBar } from '@/app/o/[organizationId]/components/search-input-bar'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  organizationSearchParsers,
  organizationSearchUrlKeys,
} from '@/app/o/[organizationId]/search/search-params'
import { SearchResultsView } from '@/app/o/[organizationId]/search/search-results-view'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { MicrophonePermissionHelp } from '@/app/workspace/[workspaceId]/home/components/user-input/components/microphone-permission-help/microphone-permission-help'
import { useVoiceInput } from '@/hooks/use-voice-input'

interface SearchFieldProps {
  initialValue: string
  onSubmit: (value: string) => void
}

/** Search commits a query on submit while retaining an independent editable draft. */
function SearchField({ initialValue, onSubmit }: SearchFieldProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { organization } = useOrganizationContext()
  const [value, setValue] = useState(initialValue)
  const voice = useVoiceInput({
    organizationId: organization.id,
    getValue: () => value,
    onChange: setValue,
  })
  const canSubmit = value.trim().length > 0

  useEffect(() => inputRef.current?.focus(), [])

  return (
    <>
      <SearchInputBar
        inputRef={inputRef}
        value={value}
        onChange={setValue}
        onSubmit={() => onSubmit(value)}
        floating={!initialValue.trim()}
        voiceControl={
          voice.isSupported && (
            <MicButton
              audioLevelsRef={voice.audioLevelsRef}
              isListening={voice.isListening}
              onToggle={voice.toggleListening}
            />
          )
        }
        submitControl={
          <ComposerActionButton
            type='button'
            onClick={() => onSubmit(value)}
            disabled={!canSubmit}
            aria-label='Search'
            active={canSubmit}
          >
            <ArrowUp className='block size-[16px] text-white dark:text-black' />
          </ComposerActionButton>
        }
      />
      <MicrophonePermissionHelp
        open={voice.permissionHelpOpen}
        onOpenChange={voice.setPermissionHelpOpen}
      />
    </>
  )
}

/** Raw organization search remains independent of assistant conversations. */
export function OrganizationSearch() {
  const { searchAccess } = useOrganizationContext()
  if (!searchAccess.memberScoped) return null
  return <OrganizationSearchContent />
}

function OrganizationSearchContent() {
  const { organization, mothershipAvailable } = useOrganizationContext()
  const router = useRouter()
  const [{ q }, setParams] = useQueryStates(organizationSearchParsers, organizationSearchUrlKeys)
  const summarize = (message: string, assistantSearch: WorkspaceSearchFilters) => {
    if (!mothershipAvailable) {
      toast.info('The assistant is unavailable for this organization.')
      return
    }
    const stored = MothershipHandoffStorage.store(
      { message, requestMode: 'assistant', assistantSearch },
      { organizationId: organization.id }
    )
    if (stored) router.push(`${organizationRoutes(organization.id).home}?searchLevel=adaptive`)
  }
  const submit = (draft: string) => {
    const next = draft.trim()
    if (next) void setParams({ q: next })
  }
  return (
    <SearchResultsView
      composer={<SearchField key={q} initialValue={q} onSubmit={submit} />}
      query={q.trim()}
      onSummarize={summarize}
    />
  )
}
