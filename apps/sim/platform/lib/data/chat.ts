'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSerializer, useQueryStates } from 'nuqs'
import { isApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { desktopChatScopeId } from '@/lib/desktop/chat-scope'
import {
  resourceParam,
  searchFilterParsers,
  searchFiltersFromParams,
} from '@/lib/mothership/chat/search-params'
import type { ChatMessage, ChatRequestMode } from '@/lib/mothership/chat/types'
import { createSearchResource } from '@/lib/mothership/resources/search'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import {
  organizationSearchParsers,
  organizationSearchUrlKeys,
} from '@/lib/organizations/search-params'
import { finishTerminalHandoff, isTerminalAvailable } from '@/lib/terminal/transport'
import { toast } from '@/lib/toast/sink'
import type { ChatRuntime, ToolDecision } from '@/app/(product)/_components/chat/model'
import { getMothershipUseChatOptions, useChat } from '@/hooks/mothership-chat/use-chat'
import {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/hooks/mothership-chat/use-resource-panel'
import { useSubmitCopilotFeedback } from '@/hooks/queries/copilot-feedback'
import { useDecideToolPermissions } from '@/hooks/queries/copilot-tool-permissions'
import {
  useForkMothershipChat,
  useMarkMothershipChatRead,
  useMothershipChatHistory,
} from '@/hooks/queries/mothership-chats'
import { draftToSend } from '@/platform/lib/data/chat-draft'
import { isRunningWait, toPlatformTurns } from '@/platform/lib/data/chat-model'
import { useAssistantReview } from '@/platform/lib/data/chat-review'
import { useOrganization } from '@/platform/lib/data/organization'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { type SummaryRequest, useSendSummary } from '@/platform/lib/data/search-summary'
import { plural } from '@/platform/shared/plural'
import { useToolPermissionStore } from '@/stores/tool-permission/store'

/** A running `wait` counts down, and nothing else re-renders during the pause. */
function useWaitClock(messages: readonly ChatMessage[], streaming: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  const waiting = streaming && isRunningWait(messages)
  useEffect(() => {
    if (!waiting) return
    const interval = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(interval)
  }, [waiting])
  return waiting ? now : 0
}

/** History timestamps, then the first instant a live message appeared. */
function useMessageClock(chatId: string | undefined) {
  const history = useMothershipChatHistory(chatId)
  const seen = useRef<Map<string, number> | null>(null)
  const persisted = useMemo(() => {
    const map = new Map<string, number>()
    for (const message of history.data?.messages ?? []) {
      const at = message.timestamp ? Date.parse(message.timestamp) : Number.NaN
      map.set(message.id, Number.isNaN(at) ? 0 : at)
    }
    return map
  }, [history.data?.messages])
  const sentAt = useCallback(
    (message: ChatMessage): number | undefined => {
      const stored = persisted.get(message.id)
      if (stored) return stored
      seen.current ??= new Map()
      const first = seen.current.get(message.id)
      if (first) return first
      const at = Date.now()
      seen.current.set(message.id, at)
      return at
    },
    [persisted]
  )
  const isPersisted = useCallback((id: string) => persisted.has(id), [persisted])
  return {
    sentAt,
    isPersisted,
    title: history.data?.title,
    loadFailed: history.isError,
  }
}

/** An Assistant chat's address: Search's query, filters and mode, and the open resource. */
const serializeSearchChat = createSerializer({
  ...organizationSearchParsers,
  ...searchFilterParsers,
  [resourceParam.key]: resourceParam.parser,
})

interface LiveChatOptions {
  chatId?: string
  requestMode: ChatRequestMode
  /** A chat's URL, for a surface other than Chat. */
  chatPath?: (chatId: string) => string
  /**
   * Which Search view an Assistant chat is under as it gets its address: the conversation's own, or
   * Search's, when the reader switched away while the first turn was admitted.
   */
  searchView?: 'search' | 'assistant'
  /** A summary to send under its own search scope; `onSummaryConsumed` fires as it goes out. */
  summaryRequest?: SummaryRequest
  onSummaryConsumed?: (id: string) => void
}

/**
 * Drives the existing chat hook for a Platform surface. Every send, steer, stream, stop and
 * reconnect rule stays in `useChat`; this module only supplies this app's URLs and projects its state.
 */
export function useLiveChatRuntime({
  chatId,
  requestMode,
  chatPath,
  searchView = 'assistant',
  summaryRequest,
  onSummaryConsumed,
}: LiveChatOptions) {
  const surface = useOrganization()
  const { organization } = surface
  const pathFor = chatPath ?? ((id: string) => surfaceHref(surface, `/chat/${id}`))
  const organizationId = organization.id
  const router = useRouter()
  const controller = useResourcePanelController()
  const { data: session } = useSession()
  const [searchState] = useQueryStates(
    { ...organizationSearchParsers, ...searchFilterParsers },
    organizationSearchUrlKeys
  )
  const chat = useChat({ organizationId }, chatId, {
    ...getMothershipUseChatOptions({
      requestMode,
      isNewChatRoute: (pathname) =>
        pathname === surfaceHref(surface, '/chat') || pathname === surfaceHref(surface, '/search'),
      getChatUrl: (id) => {
        // An Assistant chat keeps Search's view state as the reader has it now, including a choice
        // the URL has not caught up with; a Build chat keeps only its open resource.
        const resource = controller.activeResourceState[0]
        if (requestMode === 'assistant')
          return serializeSearchChat(pathFor(id), {
            ...searchState,
            mode: searchView,
            [resourceParam.key]: resource ?? null,
          })
        return `${pathFor(id)}${resource ? `?resource=${encodeURIComponent(resource)}` : ''}`
      },
      onResourceEvent: controller.onResourceEvent,
      activeResourceState: controller.activeResourceState,
    }),
  })
  const panel = useChatResourcePanel(chat, controller, session?.user?.id)
  const streaming = chat.isSending || chat.isReconnecting
  const clock = useMessageClock(chat.resolvedChatId)
  const now = useWaitClock(chat.messages, streaming)
  const { sentAt, isPersisted } = clock
  const turns = useMemo(
    () => toPlatformTurns(chat.messages, { streaming, sentAt, now, isPersisted }),
    [chat.messages, streaming, sentAt, now, isPersisted]
  )

  const { sendMessage, stopGeneration } = chat
  const assistantOptions = useMemo(
    () => ({
      requestMode,
      ...(requestMode === 'assistant' ? { assistantSearchLevel: 'fast' as const } : {}),
    }),
    [requestMode]
  )

  const { mutate: markRead } = useMarkMothershipChatRead({ organizationId })
  useEffect(() => {
    if (chat.resolvedChatId && !streaming) markRead(chat.resolvedChatId)
  }, [chat.resolvedChatId, streaming, markRead])

  useEffect(() => {
    if (chat.error) toast.error(chat.error)
  }, [chat.error])

  useEffect(() => {
    if (chatId) return
    const handoff = MothershipHandoffStorage.consume({ organizationId }, undefined, requestMode)
    if (handoff && (handoff.message || handoff.fileAttachments?.length)) {
      void sendMessage(handoff.message ?? '', handoff.fileAttachments, handoff.contexts, {
        ...assistantOptions,
        ...(handoff.resumeUserMessageId
          ? { resumeUserMessageId: handoff.resumeUserMessageId }
          : {}),
        ...(handoff.assistantSearch ? { assistantSearch: handoff.assistantSearch } : {}),
      })
    }
  }, [chatId, organizationId, requestMode, sendMessage, assistantOptions])

  /** A new chat reopens the results tab its address selects, as legacy Home did; closing it clears the URL. */
  const { q, source, updated, from, to } = searchState
  const hasChat = Boolean(chatId) || chat.messages.length > 0
  const { addResourceFromUser } = panel
  useEffect(() => {
    const query = q.trim()
    if (hasChat || !query) return
    const resource = createSearchResource({
      scope: { kind: 'organization', organizationId },
      query,
      filters: searchFiltersFromParams({ source, updated, from, to }, Date.now()),
    })
    if (
      controller.activeResourceParam !== resource.id ||
      chat.resources.some((entry) => entry.id === resource.id)
    )
      return
    addResourceFromUser(resource)
  }, [
    hasChat,
    q,
    source,
    updated,
    from,
    to,
    organizationId,
    controller.activeResourceParam,
    chat.resources,
    addResourceFromUser,
  ])

  useSendSummary({
    request: summaryRequest,
    onConsumed: onSummaryConsumed,
    send: useCallback(
      ({ message, assistantSearch }: SummaryRequest) =>
        void sendMessage(message, undefined, undefined, { ...assistantOptions, assistantSearch }),
      [sendMessage, assistantOptions]
    ),
  })

  const register = useToolPermissionStore((state) => state.register)
  const unregister = useToolPermissionStore((state) => state.unregister)
  const registerApproval = useCallback(
    (toolCallId: string) => {
      register(toolCallId)
      return () => unregister(toolCallId)
    },
    [register, unregister]
  )
  const markSubmitted = useToolPermissionStore((state) => state.markSubmitted)
  const clearSubmitted = useToolPermissionStore((state) => state.clearSubmitted)
  const awaitingIds = useToolPermissionStore((state) => state.awaitingIds)
  const submittedIds = useToolPermissionStore((state) => state.submittedIds)
  const { mutateAsync: decideToolPermissions } = useDecideToolPermissions()
  const approvals = useMemo(
    () => ({
      outstanding: awaitingIds.filter((id) => !submittedIds.includes(id)),
      submitted: submittedIds,
    }),
    [awaitingIds, submittedIds]
  )
  const decideTools = useCallback(
    async (ids: readonly string[], decision: ToolDecision): Promise<'ok' | 'gone'> => {
      const list = [...ids]
      markSubmitted(list)
      try {
        await decideToolPermissions({ ids: list, decision })
        return 'ok'
      } catch (error) {
        if (isApiClientError(error) && error.status === 404) return 'gone'
        clearSubmitted(list)
        throw error
      }
    },
    [clearSubmitted, decideToolPermissions, markSubmitted]
  )

  const submitFeedback = useSubmitCopilotFeedback()
  const forkChat = useForkMothershipChat({ organizationId })
  const review = useAssistantReview({
    organizationId,
    chatId: chat.resolvedChatId,
    messages: chat.messages,
    active: chat.isSending,
    enabled: requestMode === 'assistant',
  })

  const openResource: ChatRuntime['openResource'] = ({ type, id, title, workspaceId }) => {
    if (!workspaceId) {
      toast.error('This resource has no workspace address.')
      return
    }
    panel.addResourceFromUser({
      type: type as MothershipResource['type'],
      id,
      title,
      workspaceId,
    })
    panel.expandResource()
  }

  const runtime: ChatRuntime = {
    chatId: chat.resolvedChatId,
    title: clock.title ?? 'New chat',
    status:
      chat.isChatHistoryPending && chatId && !chat.messages.length
        ? 'loading'
        : chat.isReconnecting
          ? 'reconnecting'
          : chat.isSending
            ? 'sending'
            : 'idle',
    loadFailed: clock.loadFailed && !chat.messages.length,
    turns,
    send: (draft) => {
      if (draft.attachments.some((attachment) => attachment.uploading)) return false
      const { files, contexts } = draftToSend(draft)
      if (!draft.text && !files.length) return false
      if (requestMode !== 'assistant') panel.prepareResourceViewForAgentTurn()
      void sendMessage(
        draft.text,
        files.length ? files : undefined,
        contexts.length ? contexts : undefined,
        assistantOptions
      )
      return undefined
    },
    sendText: (text) => {
      void sendMessage(text, undefined, undefined, assistantOptions)
    },
    stop: () => {
      void stopGeneration()
    },
    retryMessage: chat.retryMessage,
    dismissMessage: chat.dismissMessage,
    approvals,
    registerApproval,
    decideTools,
    review,
    openResource,
    viewSources: (turnId, requestId) =>
      panel.addResourceFromUser({
        type: 'sources',
        id: 'cited-sources',
        title: 'Sources',
        sources: { messageId: turnId, ...(requestId ? { requestId } : {}) },
      }),
    finishTerminalHandoff: isTerminalAvailable()
      ? (terminalId) => {
          void finishTerminalHandoff(terminalId, desktopChatScopeId('', chat.resolvedChatId))
        }
      : undefined,
    rate: async ({ query, response, positive, details }) => {
      if (!chat.resolvedChatId) return
      await submitFeedback.mutateAsync({
        chatId: chat.resolvedChatId,
        userQuery: query,
        agentResponse: response,
        isPositiveFeedback: positive,
        feedback: details,
      })
    },
    fork: async (turnId) => {
      if (!chat.resolvedChatId) return
      const result = await forkChat.mutateAsync({
        chatId: chat.resolvedChatId,
        upToMessageId: turnId,
      })
      if (result.failedFileCopies) {
        toast.warning(`${plural(result.failedFileCopies, 'file')} could not be copied to the fork`)
      }
      router.push(pathFor(result.id))
    },
  }
  return { runtime, chat, panel, controller }
}
