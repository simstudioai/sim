'use client'

import { lazy, Suspense, useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Chip, ComposerActionButton, cn } from '@sim/emcn'
import { ArrowUp, Plus, Search, Sparkles, StopFilled } from '@sim/emcn/icons'
import { generateId } from '@sim/utils/id'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { HEADER_ACTION_CLUSTER } from '@/components/page-header-bar'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { OrganizationSummaryRequest } from '@/app/o/[organizationId]/components/organization-conversation'
import { SearchInputBar } from '@/app/o/[organizationId]/components/search-input-bar'
import { SearchLandingHistory } from '@/app/o/[organizationId]/components/search-landing-history'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  organizationSearchParsers,
  organizationSearchUrlKeys,
} from '@/app/o/[organizationId]/search/search-params'
import { SearchResultsView } from '@/app/o/[organizationId]/search/search-results-view'
import { useSearchHistoryActions } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-history-context'
import { RESOURCE_HEADER_CLASSES } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { MicrophonePermissionHelp } from '@/app/workspace/[workspaceId]/home/components/user-input/components/microphone-permission-help/microphone-permission-help'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { useHydrated } from '@/hooks/use-hydrated'
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
  const hydrated = useHydrated()
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
  const canSubmit = hydrated && value.trim().length > 0

  useEffect(() => {
    if (hydrated) inputRef.current?.focus()
  }, [hydrated])

  const field = (
    <SearchInputBar
      inputRef={inputRef}
      value={value}
      disabled={!hydrated}
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
    mothershipAvailable && (mode ?? (hasConversation ? 'assistant' : 'search')) === 'assistant'
      ? 'assistant'
      : 'search'
  const [assistantOpened, setAssistantOpened] = useState(activeMode === 'assistant')
  const [conversationInstance, setConversationInstance] = useState(0)
  const [isStartingNew, startNewTransition] = useTransition()
  const [summaries, setSummaries] = useState<OrganizationSummaryRequest[]>([])
  const consumeSummary = useCallback(
    (id: string) => setSummaries((current) => current.filter((request) => request.id !== id)),
    []
  )
  const changeMode = (next: 'search' | 'assistant') => {
    if (next === 'assistant') setAssistantOpened(true)
    void setParams({ mode: next }, { history: 'push' })
  }
  const startNew = () => {
    setSummaries([])
    const { clearDraft } = useMothershipDraftsStore.getState()
    const scope = `${userId}:organization:${organization.id}`
    if (activeMode === 'assistant') {
      clearDraft(`${scope}:search-assistant`)
    } else {
      clearDraft(`${scope}:search`)
      clearDraft(`${scope}:search:query:`)
    }
    startNewTransition(() => {
      setConversationInstance((current) => current + 1)
      router.push(activeMode === 'assistant' ? `${routes.search}?mode=assistant` : routes.search, {
        scroll: false,
      })
    })
  }
  const summarize = (message: string, assistantSearch: WorkspaceSearchFilters) => {
    setSummaries((current) => [...current, { id: generateId(), message, assistantSearch }])
    changeMode('assistant')
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
  const newLabel = activeMode === 'assistant' ? 'New chat' : 'New search'
  const header = (
    <>
      <nav aria-label='Search views' className={HEADER_ACTION_CLUSTER}>
        {SEARCH_MODES.filter((entry) => mothershipAvailable || entry.value === 'search').map(
          (entry) => (
            <Chip
              key={entry.value}
              active={activeMode === entry.value}
              aria-current={activeMode === entry.value ? 'page' : undefined}
              leftIcon={entry.icon}
              mobileCompact
              onClick={() => changeMode(entry.value)}
            >
              {entry.label}
            </Chip>
          )
        )}
      </nav>
      {(hasConversation || (activeMode === 'search' && q.trim())) && (
        <Chip
          leftIcon={Plus}
          aria-label={newLabel}
          onClick={startNew}
          disabled={isStartingNew}
          mobileCompact
        >
          <span className='hidden md:inline'>{newLabel}</span>
          <span className='md:hidden'>New</span>
        </Chip>
      )}
    </>
  )
  return (
    <div className='h-full min-h-0 min-w-0 bg-[var(--bg)] pt-[var(--workspace-content-title-bar-inset)]'>
      <div className='flex h-full min-h-0 min-w-0 flex-col [--workspace-content-title-bar-inset:0px]'>
        {(assistantOpened || hasConversation || activeMode === 'assistant') &&
          mothershipAvailable && (
            <div
              inert={activeMode !== 'assistant'}
              className={cn(
                'min-h-0 min-w-0 flex-1 flex-col',
                activeMode === 'assistant' ? 'flex' : 'hidden'
              )}
            >
              <Suspense fallback={<HomeFallback header={header} />}>
                <OrganizationConversation
                  key={conversationInstance}
                  requestMode='assistant'
                  chatId={chatId}
                  header={header}
                  active={activeMode === 'assistant'}
                  summaryRequest={summaries[0]}
                  onSummaryConsumed={consumeSummary}
                />
              </Suspense>
            </div>
          )}
        {activeMode === 'search' && (
          <>
            <div className={cn(RESOURCE_HEADER_CLASSES.layout, RESOURCE_HEADER_CLASSES.content)}>
              {header}
            </div>
            <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
              <SearchResultsView
                composer={
                  <SearchField key={q} userId={userId} initialValue={q} onSubmit={submit} />
                }
                query={q.trim()}
                onSummarize={mothershipAvailable ? summarize : undefined}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
