'use client'

import { useEffect, useRef } from 'react'
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
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'

interface OrganizationSearchProps {
  userId: string
}

interface SearchFieldProps {
  userId: string
  initialValue: string
  onSubmit: (value: string) => void
}

/** Search commits a query on submit while retaining an independent editable draft. */
function SearchField({ userId, initialValue, onSubmit }: SearchFieldProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { organization } = useOrganizationContext()
  const draftKey = `${userId}:organization:${organization.id}:search`
  const draft = useMothershipDraftsStore((state) => state.drafts[draftKey])
  const value =
    draft && (!initialValue || draft.searchQuery === initialValue) ? draft.text : initialValue
  const setValue = (text: string) => {
    useMothershipDraftsStore.getState().setDraft(draftKey, { text, searchQuery: initialValue })
  }
  const submit = () => {
    if (!value.trim()) return
    useMothershipDraftsStore.getState().clearDraft(draftKey)
    onSubmit(value)
  }
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
        onSubmit={submit}
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
            onClick={submit}
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
export function OrganizationSearch({ userId }: OrganizationSearchProps) {
  const { searchAccess } = useOrganizationContext()
  if (!searchAccess.memberScoped) return null
  return <OrganizationSearchContent userId={userId} />
}

function OrganizationSearchContent({ userId }: OrganizationSearchProps) {
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
      composer={<SearchField key={q} userId={userId} initialValue={q} onSubmit={submit} />}
      query={q.trim()}
      onSummarize={summarize}
    />
  )
}
