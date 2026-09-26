'use client'

import { useEffect, useRef } from 'react'
import { ComposerActionButton, toast } from '@sim/emcn'
import { ArrowUp, Loader } from '@sim/emcn/icons'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { organizationRoutes } from '@/lib/navigation/paths'
import { SearchInputBar } from '@/app/o/[organizationId]/components/search-input-bar'
import { SearchLandingHistory } from '@/app/o/[organizationId]/components/search-landing-history'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  organizationSearchParsers,
  organizationSearchUrlKeys,
} from '@/app/o/[organizationId]/search/search-params'
import { SearchResultsView } from '@/app/o/[organizationId]/search/search-results-view'
import { useSearchHistoryActions } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-history-context'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { MicrophonePermissionHelp } from '@/app/workspace/[workspaceId]/home/components/user-input/components/microphone-permission-help/microphone-permission-help'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
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
  const isSearching =
    useIsFetching({
      queryKey: knowledgeKeys.searchQuery(
        resourceScopeKey({ kind: 'organization', organizationId: organization.id }),
        initialValue.trim(),
        userId
      ),
    }) > 0
  const latestDraftKey = `${userId}:organization:${organization.id}:search`
  const latestDraft = useMothershipDraftsStore((state) => state.drafts[latestDraftKey])
  const ownerQuery = initialValue || latestDraft?.searchQuery || ''
  const draftKey = `${latestDraftKey}:query:${encodeURIComponent(ownerQuery)}`
  const draft = useMothershipDraftsStore((state) => state.drafts[draftKey])
  const value =
    draft?.text ?? (latestDraft?.searchQuery === ownerQuery ? latestDraft.text : initialValue)
  const setValue = (text: string) => {
    const { setDraft } = useMothershipDraftsStore.getState()
    const payload = { text, searchQuery: ownerQuery }
    setDraft(draftKey, payload)
    setDraft(latestDraftKey, payload)
  }
  const pending = isSearching && value.trim() === initialValue.trim()
  const submit = (text = value) => {
    if (!text.trim() || (isSearching && text.trim() === initialValue.trim())) return
    const { clearDraft } = useMothershipDraftsStore.getState()
    clearDraft(draftKey)
    clearDraft(`${latestDraftKey}:query:${encodeURIComponent(text.trim())}`)
    if (latestDraft?.searchQuery === ownerQuery) clearDraft(latestDraftKey)
    onSubmit(text)
  }
  const voice = useVoiceInput({
    organizationId: organization.id,
    getValue: () => value,
    onChange: setValue,
  })
  const canSubmit = value.trim().length > 0

  useEffect(() => inputRef.current?.focus(), [])

  const field = (
    <SearchInputBar
      inputRef={inputRef}
      value={value}
      onChange={setValue}
      onSubmit={() => submit()}
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
          onClick={() => submit()}
          disabled={!canSubmit || pending}
          aria-label={pending ? 'Searching' : 'Search'}
          aria-busy={pending}
          active={canSubmit}
        >
          {pending ? (
            <Loader className='size-[16px] animate-spin text-white motion-reduce:animate-none dark:text-black' />
          ) : (
            <ArrowUp className='block size-[16px] text-white dark:text-black' />
          )}
        </ComposerActionButton>
      }
    />
  )
  return (
    <>
      {!initialValue.trim() ? (
        <SearchLandingHistory
          organizationId={organization.id}
          userId={userId}
          onSearch={(query) => submit(query)}
        >
          {field}
        </SearchLandingHistory>
      ) : (
        field
      )}
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
  const { recordQuery } = useSearchHistoryActions()
  const router = useRouter()
  const queryClient = useQueryClient()
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
    if (!next) return
    recordQuery(next)
    if (next === q.trim()) {
      void queryClient.invalidateQueries({
        queryKey: knowledgeKeys.searchQuery(
          resourceScopeKey({ kind: 'organization', organizationId: organization.id }),
          next,
          userId
        ),
      })
    } else {
      void setParams({ q: next })
    }
  }
  return (
    <SearchResultsView
      composer={<SearchField key={q} userId={userId} initialValue={q} onSubmit={submit} />}
      query={q.trim()}
      onSummarize={summarize}
    />
  )
}
