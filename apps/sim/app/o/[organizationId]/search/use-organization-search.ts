'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { generateId } from '@sim/utils/id'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { BrowserStorage } from '@/lib/core/utils/browser-storage'
import { organizationRoutes } from '@/lib/navigation/paths'
import { organizationDraftKey, SEARCH_ASSISTANT_DRAFT_SLOT } from '@/lib/organizations/draft-key'
import type { OrganizationSummaryRequest } from '@/app/o/[organizationId]/components/use-organization-conversation'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  organizationSearchParsers,
  organizationSearchUrlKeys,
} from '@/app/o/[organizationId]/search/search-params'
import { useSearchHistoryActions } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-history-context'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { useHydrated } from '@/hooks/use-hydrated'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'

export const SEARCH_MODES = [
  { value: 'search', label: 'Search' },
  { value: 'assistant', label: 'Assistant' },
] as const

type SearchMode = (typeof SEARCH_MODES)[number]['value']

const NEW_CHAT_LABEL = 'New chat'

/** What an Assistant chat's New control does, here and on a page that hosts one itself. */
export function useStartNewConversation() {
  const router = useRouter()
  const [conversationInstance, setConversationInstance] = useState(0)
  const [isStartingNew, startNewTransition] = useTransition()
  const startNew = (href: string, clearDrafts: () => void) => {
    clearDrafts()
    startNewTransition(() => {
      setConversationInstance((current) => current + 1)
      router.push(href, { scroll: false })
    })
  }
  return { conversationInstance, isStartingNew, startNew, newChatLabel: NEW_CHAT_LABEL }
}

/** Search's address from a page that carries an Assistant chat but not the Search view beside it. */
export function useSearchViewHref() {
  const { organization } = useOrganizationContext()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { search } = organizationRoutes(organization.id)
  const onChat = pathname.startsWith(`${search}/chat/`)
  const params = new URLSearchParams(onChat ? searchParams.toString() : '')
  params.set('mode', 'search')
  return `${onChat ? pathname : search}?${params}`
}

interface UseOrganizationSearchProps {
  userId: string
  chatId?: string
}

function searchDraftKeys(userId: string | undefined, organizationId: string) {
  const latest = organizationDraftKey(userId, organizationId, 'search')
  return {
    latest,
    assistant: organizationDraftKey(userId, organizationId, SEARCH_ASSISTANT_DRAFT_SLOT),
    query: (query: string) => `${latest}:query:${encodeURIComponent(query)}`,
  }
}

/**
 * Everything Organization Search does, independent of how it looks: the mode pinned in the URL, the
 * Summarize hand-off to Assistant, New chat or search, and committing a query.
 */
export function useOrganizationSearch({ userId, chatId }: UseOrganizationSearchProps) {
  const starter = useStartNewConversation()
  const { organization, mothershipAvailable } = useOrganizationContext()
  const { recordQuery } = useSearchHistoryActions()
  const pathname = usePathname()
  const hasSearchParams = useSearchParams().toString() !== ''
  const routes = organizationRoutes(organization.id)
  const hasConversation = Boolean(chatId) || pathname.startsWith(`${routes.search}/chat/`)
  const queryClient = useQueryClient()
  const [{ q, mode }, setParams] = useQueryStates(
    organizationSearchParsers,
    organizationSearchUrlKeys
  )
  const routeMode = mode ?? (hasConversation ? 'assistant' : hasSearchParams ? 'search' : null)
  const activeMode = mothershipAvailable ? routeMode : 'search'
  const preferenceKey = `organization-search-mode:${userId}:${organization.id}`
  const [assistantOpened, setAssistantOpened] = useState(activeMode === 'assistant')
  const [summaries, setSummaries] = useState<OrganizationSummaryRequest[]>([])
  const consumeSummary = useCallback(
    (id: string) => setSummaries((current) => current.filter((request) => request.id !== id)),
    []
  )
  useEffect(() => {
    if (!mothershipAvailable) return
    if (routeMode) {
      BrowserStorage.setItem(preferenceKey, routeMode)
      return
    }
    const savedMode = BrowserStorage.getItem<unknown>(preferenceKey, null)
    // Pin the mode to this history entry so Back survives a later preference change.
    void setParams({ mode: savedMode === 'assistant' ? 'assistant' : 'search' })
  }, [mothershipAvailable, preferenceKey, routeMode, setParams])

  if (activeMode === 'assistant' && !assistantOpened) setAssistantOpened(true)

  const changeMode = (next: SearchMode) => {
    void setParams({ mode: next }, { history: 'push' })
  }
  const startNew = () => {
    setSummaries([])
    starter.startNew(
      mothershipAvailable ? `${routes.search}?mode=${activeMode}` : routes.search,
      () => {
        const { clearDraft } = useMothershipDraftsStore.getState()
        const drafts = searchDraftKeys(userId, organization.id)
        if (activeMode === 'assistant') {
          clearDraft(drafts.assistant)
        } else {
          clearDraft(drafts.latest)
          clearDraft(drafts.query(''))
        }
      }
    )
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
  return {
    chatId,
    query: q,
    activeMode,
    modes: SEARCH_MODES.filter((entry) => mothershipAvailable || entry.value === 'search'),
    changeMode,
    assistantMounted: (assistantOpened || hasConversation) && mothershipAvailable,
    conversationInstance: starter.conversationInstance,
    pendingSummary: summaries[0],
    consumeSummary,
    summarize: mothershipAvailable ? summarize : undefined,
    submit,
    newLabel: activeMode === 'assistant' ? starter.newChatLabel : 'New search',
    canStartNew: hasConversation || (activeMode === 'search' && Boolean(q.trim())),
    startNew,
    isStartingNew: starter.isStartingNew,
  }
}

export type OrganizationSearchState = ReturnType<typeof useOrganizationSearch>

interface UseSearchFieldDraftProps {
  userId: string
  initialValue: string
  onSubmit: (value: string) => void
}

/** Search commits a query on submit while retaining an independent editable draft. */
export function useSearchFieldDraft({ userId, initialValue, onSubmit }: UseSearchFieldDraftProps) {
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
  const drafts = searchDraftKeys(userId, organization.id)
  const latestDraftKey = drafts.latest
  const latestDraft = useMothershipDraftsStore((state) => state.drafts[latestDraftKey])
  const ownerQuery = initialValue || latestDraft?.searchQuery || ''
  const draftKey = drafts.query(ownerQuery)
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
    clearDraft(drafts.query(text.trim()))
    onSubmit(text)
  }
  const voice = useVoiceInput({
    organizationId: organization.id,
    getValue: () => value,
    onChange: setValue,
  })

  useEffect(() => {
    if (hydrated) inputRef.current?.focus()
  }, [hydrated])

  return {
    inputRef,
    hydrated,
    value,
    setValue,
    submit,
    voice,
    isSearching,
    canSubmit: hydrated && value.trim().length > 0,
    /** The field's action button: Stop while this query runs, otherwise Search. */
    submitOrStop: () => (isSearching ? void queryClient.cancelQueries({ queryKey }) : submit()),
  }
}
