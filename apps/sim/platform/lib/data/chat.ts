'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { desktopChatScopeId } from '@/lib/desktop/chat-scope'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import { finishTerminalHandoff, isTerminalAvailable } from '@/lib/terminal/transport'
import {
  getMothershipUseChatOptions,
  useChat,
} from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/app/workspace/[workspaceId]/home/hooks/use-resource-panel'
import type {
  ChatMessage,
  ChatRequestMode,
  FileAttachmentForApi,
} from '@/app/workspace/[workspaceId]/home/types'
import { useSubmitCopilotFeedback } from '@/hooks/queries/copilot-feedback'
import { useDecideToolPermissions } from '@/hooks/queries/copilot-tool-permissions'
import {
  useForkMothershipChat,
  useMarkMothershipChatRead,
  useMothershipChatHistory,
} from '@/hooks/queries/mothership-chats'
import type {
  ChatRuntime,
  PlatformQueuedMessage,
  ToolDecision,
} from '@/platform/app/(shell)/_components/chat/model'
import { platformUrl } from '@/platform/lib/data/base-path'
import { draftToSend } from '@/platform/lib/data/chat-draft'
import { toPlatformTurns } from '@/platform/lib/data/chat-model'
import { useAssistantReview } from '@/platform/lib/data/chat-review'
import { useOrganization } from '@/platform/lib/data/organization'
import { plural } from '@/platform/shared/plural'
import { toast } from '@/platform/shared/toast'
import type { ChatContext } from '@/stores/panel'
import { useToolPermissionStore } from '@/stores/tool-permission/store'

/** A running `wait` counts down, and nothing else re-renders during the pause. */
function useWaitClock(messages: readonly ChatMessage[], streaming: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  const waiting =
    streaming &&
    (messages.at(-1)?.contentBlocks ?? []).some(
      (block) => block.toolCall?.name === 'wait' && block.toolCall.status === 'executing'
    )
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

function toQueued(
  message: ReturnType<typeof useChat>['messageQueue'][number]
): PlatformQueuedMessage {
  return {
    id: message.id,
    text: message.content,
    attachmentCount: (message.fileAttachments?.length ?? 0) + (message.contexts?.length ?? 0),
    needsReview: message.hasUnavailableContexts,
    locked: message.admissionUnknown,
  }
}

function isNewChatRoute(pathname: string): boolean {
  return pathname === '/chat' || pathname === '/search'
}

interface LiveChatOptions {
  chatId?: string
  requestMode: ChatRequestMode
  /** What to do with a queued message handed back to the composer. */
  onRestoreQueued: (draft: {
    text: string
    files: FileAttachmentForApi[]
    contexts: ChatContext[]
  }) => void
  /** A chat's URL, for a surface other than Chat. */
  chatPath?: (chatId: string) => string
}

/**
 * Drives the existing chat hook for a Platform surface. Every send, stream, stop, reconnect and
 * queue rule stays in `useChat`; this module only supplies this app's URLs and projects its state.
 */
export function useLiveChatRuntime({
  chatId,
  requestMode,
  onRestoreQueued,
  chatPath = (id) => `/chat/${id}`,
}: LiveChatOptions) {
  const { organization, canBuild } = useOrganization()
  const organizationId = organization.id
  const router = useRouter()
  const controller = useResourcePanelController()
  const { data: session } = useSession()
  const chat = useChat({ organizationId }, chatId, {
    ...getMothershipUseChatOptions({
      requestMode,
      isNewChatRoute,
      getChatUrl: (id) => {
        // An Assistant chat keeps its Search view state; a Build chat keeps only its open resource.
        const resource = controller.activeResourceState[0]
        const query =
          requestMode === 'assistant'
            ? window.location.search
            : resource
              ? `?resource=${encodeURIComponent(resource)}`
              : ''
        return platformUrl(`${chatPath(id)}${query}`)
      },
      onResourceEvent: controller.onResourceEvent,
      activeResourceState: controller.activeResourceState,
    }),
    projectsDesktopTabs: false,
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

  const { sendMessage, stopGeneration, sendNow } = chat
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
    queue: chat.messageQueue.map(toQueued),
    editingQueuedId: chat.editingQueuedId,
    dispatchingQueuedId: chat.dispatchingHeadId,
    send: (draft) => {
      if (requestMode !== 'assistant' && !canBuild) return false
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
    removeQueued: chat.removeFromQueue,
    sendQueuedNow: (id) => {
      void sendNow(id)
    },
    editQueued: (id) => {
      const queued = chat.editQueuedMessage(id)
      if (queued)
        onRestoreQueued({
          text: queued.content,
          files: queued.fileAttachments ?? [],
          contexts: queued.contexts ?? [],
        })
    },
    cancelQueueEdit: chat.cancelQueueEdit,
    approvals,
    registerApproval,
    decideTools,
    review,
    openResource,
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
      router.push(chatPath(result.id))
    },
  }
  return { runtime, chat, panel, controller }
}
