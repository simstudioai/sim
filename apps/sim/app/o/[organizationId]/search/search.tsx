'use client'

import { lazy, Suspense, useEffect, useRef } from 'react'
import { Chip, ChipSwitch, ComposerActionButton } from '@sim/emcn'
import { ArrowUp, Plus, Search, Sparkles, StopFilled } from '@sim/emcn/icons'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'
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
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'

const OrganizationConversation = lazy(() =>
  import('@/app/o/[organizationId]/components/organization-conversation').then((module) => ({
    default: module.OrganizationConversation,
  }))
)

const SEARCH_MODES = [
  { value: 'search', label: 'Search', icon: Search },
  { value: 'assistant', label: 'Assistant', icon: Sparkles },
] as const

interface OrganizationSearchProps {
  userId: string
  chatId?: string
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
  const queryClient = useQueryClient()
  const queryKey = knowledgeKeys.searchQuery(
    resourceScopeKey({ kind: 'organization', organizationId: organization.id }),
    initialValue.trim(),
    userId
  )
  const isSearching = useIsFetching({ queryKey }) > 0
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
  const submit = (text = value) => {
    if (!text.trim() || (isSearching && text.trim() === initialValue.trim())) return
    const { clearDraft } = useMothershipDraftsStore.getState()
    if (text.trim() === value.trim()) {
      clearDraft(draftKey)
      if (latestDraft?.searchQuery === ownerQuery) clearDraft(latestDraftKey)
    }
    clearDraft(`${latestDraftKey}:query:${encodeURIComponent(text.trim())}`)
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
            audioLevels={voice.audioLevels}
            isListening={voice.isListening}
            onToggle={voice.toggleListening}
          />
        )
      }
      submitControl={
        <ComposerActionButton
          type='button'
          onClick={() => (isSearching ? void queryClient.cancelQueries({ queryKey }) : submit())}
          disabled={!canSubmit && !isSearching}
          aria-label={isSearching ? 'Stop search' : 'Search'}
          aria-busy={isSearching}
          active={canSubmit || isSearching}
        >
          {isSearching ? (
            <StopFilled className='block size-[14px] fill-white dark:fill-black' />
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

/** Organization Search owns both document results and assistant conversations. */
export function OrganizationSearch(props: OrganizationSearchProps) {
  const { searchAccess } = useOrganizationContext()
  if (!searchAccess.memberScoped) return null
  return <OrganizationSearchContent {...props} />
}

function OrganizationSearchContent({ userId, chatId }: OrganizationSearchProps) {
  const { organization, mothershipAvailable } = useOrganizationContext()
  const { recordQuery } = useSearchHistoryActions()
  const router = useRouter()
  const pathname = usePathname()
  const routes = organizationRoutes(organization.id)
  const hasConversation = Boolean(chatId) || pathname.startsWith(`${routes.search}/chat/`)
  const queryClient = useQueryClient()
  const [{ q, mode }, setParams] = useQueryStates(
    organizationSearchParsers,
    organizationSearchUrlKeys
  )
  const activeMode =
    mothershipAvailable && (hasConversation || mode === 'assistant') ? 'assistant' : 'search'
  const changeMode = (next: 'search' | 'assistant') => {
    if (hasConversation) {
      const params = new URLSearchParams()
      if (next === 'assistant') params.set('mode', 'assistant')
      if (q) params.set('q', q)
      router.push(`${routes.search}${params.size ? `?${params}` : ''}`)
    } else {
      void setParams({ mode: next })
    }
  }
  const summarize = (message: string, assistantSearch: WorkspaceSearchFilters) => {
    const stored = MothershipHandoffStorage.store(
      { message, requestMode: 'assistant', assistantSearch },
      { organizationId: organization.id }
    )
    if (stored) void setParams({ mode: 'assistant' })
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
    <div className='flex h-full min-h-0 min-w-0 flex-col bg-[var(--bg)]'>
      <div className={PAGE_HEADER_BAR}>
        <div className={HEADER_ACTION_CLUSTER}>
          {mothershipAvailable ? (
            <ChipSwitch
              aria-label='Search mode'
              options={SEARCH_MODES}
              value={activeMode}
              onChange={changeMode}
            />
          ) : (
            <span className='text-[var(--text-body)] text-sm'>Search</span>
          )}
        </div>
        {hasConversation && (
          <Chip leftIcon={Plus} onClick={() => changeMode('search')}>
            New search
          </Chip>
        )}
      </div>
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        {activeMode === 'assistant' ? (
          <Suspense fallback={<HomeFallback />}>
            <OrganizationConversation requestMode='assistant' chatId={chatId} />
          </Suspense>
        ) : (
          <SearchResultsView
            composer={<SearchField key={q} userId={userId} initialValue={q} onSubmit={submit} />}
            query={q.trim()}
            onSummarize={mothershipAvailable ? summarize : undefined}
          />
        )}
      </div>
    </div>
  )
}
