'use client'

import { type RefObject, useEffect, useMemo, useState } from 'react'
import { toast } from '@sim/emcn-legacy'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { createSerializer, useQueryStates } from 'nuqs'
import { fetchWorkspaceResourceRef } from '@/components/mothership-chat/resolve-resource-ref'
import {
  type AttachedFile,
  useFileAttachments,
} from '@/components/workflow-editor/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import { requestJson } from '@/lib/api/client/request'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { getWorkspaceHostContextContract } from '@/lib/api/contracts/workspaces'
import { useFeatureFlag } from '@/lib/core/config/feature-flags-context'
import { resourceParam, searchFilterParsers } from '@/lib/mothership/chat/search-params'
import type {
  ChatRequestMode,
  FileAttachmentForApi,
  WorkspaceResourceRef,
} from '@/lib/mothership/chat/types'
import { organizationRoutes } from '@/lib/navigation/paths'
import { organizationDraftKey } from '@/lib/organizations/draft-key'
import { useOrganization } from '@/lib/organizations/provider'
import {
  organizationSearchParsers,
  organizationSearchUrlKeys,
} from '@/lib/organizations/search-params'
import { isWorkspaceResourceKind, workspaceResourcePath } from '@/lib/resources'
import { assertMultiFileUploadAdmission } from '@/lib/uploads/client/admission'
import {
  ASSISTANT_IMAGE_MAX_BYTES,
  ASSISTANT_IMAGE_MAX_COUNT,
  ASSISTANT_IMAGE_MAX_TOTAL_BYTES,
  isAssistantImageType,
} from '@/lib/uploads/shared/assistant-images'
import type { ConversationComposerProps } from '@/app/(site)/extension/_organization-conversation/composer'
import { getMothershipUseChatOptions, useChat } from '@/hooks/mothership-chat/use-chat'
import {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/hooks/mothership-chat/use-resource-panel'
import { useRestoredChatEntry } from '@/hooks/mothership-chat/use-restored-chat-entry'
import {
  useMarkMothershipChatRead,
  useMothershipChatHistory,
} from '@/hooks/queries/mothership-chats'
import { useSearchHistoryActions } from '@/hooks/sim-search/source-history'
import { type PrepareChatSubmission, useComposerSubmission } from '@/hooks/use-composer-submission'
import { useHydrated } from '@/hooks/use-hydrated'
import { readDraft, useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import type { ChatContext } from '@/stores/panel'

/** Search's Assistant always runs its retrieval at this level. */
const ASSISTANT_SEARCH_LEVEL = 'fast' as const

/** A turn's mode, with Assistant's fixed retrieval level and any search scope it carries. */
function chatSendOptions(requestMode: ChatRequestMode, assistantSearch?: WorkspaceSearchFilters) {
  return {
    requestMode,
    ...(requestMode === 'assistant' ? { assistantSearchLevel: ASSISTANT_SEARCH_LEVEL } : {}),
    ...(assistantSearch ? { assistantSearch } : {}),
  }
}

const serializeSearchConversation = createSerializer({
  ...organizationSearchParsers,
  ...searchFilterParsers,
  [resourceParam.key]: resourceParam.parser,
})

/** A finished upload as the chat API and the saved draft carry it. */
function toApiAttachments(files: readonly AttachedFile[]): FileAttachmentForApi[] {
  return files.flatMap((file) =>
    file.key
      ? [
          {
            id: file.id,
            key: file.key,
            filename: file.name,
            media_type: file.type,
            size: file.size,
            path: file.path,
          },
        ]
      : []
  )
}

interface UseConversationGateOptions {
  chatId?: string
  requestMode: ChatRequestMode
}

/** Whether the surface may mount, and for which identity. Its key remounts on any change to one. */
export function useConversationGate({ chatId, requestMode }: UseConversationGateOptions) {
  const { organization, viewer, searchAccess, mothershipAvailable } = useOrganization()
  const isClient = useHydrated()
  const isRestoredChatEntry = useRestoredChatEntry({ chatId })
  if (!mothershipAvailable || (requestMode === 'assistant' && !searchAccess.memberScoped))
    return { status: 'denied' } as const
  if (isRestoredChatEntry) return { status: 'restoring' } as const
  if (!isClient) return { status: 'waiting' } as const
  return {
    status: 'ready',
    instanceKey: `${viewer.userId}:${organization.id}:${chatId ?? 'new'}`,
  } as const
}

interface UseOrganizationConversationOptions {
  chatId?: string
  requestMode: ChatRequestMode
  draftNamespace: string
  fileDropTarget: RefObject<HTMLElement | null>
  onChatIdResolved: (chatId: string) => void
  prepareSubmission: PrepareChatSubmission
  onSubmitted: () => void
}

/**
 * An organization conversation's behavior in the extension's side panel: the chat, its drafts,
 * attachments, submission, and resources.
 */
export function useOrganizationConversation({
  chatId,
  requestMode: destinationMode,
  draftNamespace,
  fileDropTarget,
  onChatIdResolved,
  prepareSubmission,
  onSubmitted,
}: UseOrganizationConversationOptions) {
  const { organization, viewer } = useOrganization()
  const userId = viewer.userId
  const planEnabled = useFeatureFlag('mothership-plan-mode')
  const [planning, setPlanning] = useState(false)
  const requestMode =
    destinationMode === 'agent' && !chatId && planEnabled && planning ? 'plan' : destinationMode
  const [searchParams] = useQueryStates(
    { ...organizationSearchParsers, ...searchFilterParsers },
    organizationSearchUrlKeys
  )
  const controller = useResourcePanelController()
  const queryClient = useQueryClient()
  /**
   * The organization's list holds the viewer's workspace chats too, and the server admits a send or
   * Stop only under the scope a chat was created in. An existing chat's scope comes from its history
   * (the read `useChat` makes), and nothing sends before it lands; a new chat is the organization's.
   */
  const { data: openedHistory } = useMothershipChatHistory(chatId)
  const scopeKnown = !chatId || openedHistory !== undefined
  const chat = useChat(
    { organizationId: organization.id, workspaceId: openedHistory?.workspaceId ?? undefined },
    chatId,
    {
      ...getMothershipUseChatOptions({
        requestMode,
        getChatUrl:
          destinationMode === 'assistant'
            ? (id) =>
                serializeSearchConversation(organizationRoutes(organization.id).searchChat(id), {
                  ...searchParams,
                  mode: 'assistant',
                  resource: controller.activeResourceState[0],
                })
            : undefined,
        onResourceEvent: controller.onResourceEvent,
        activeResourceState: controller.activeResourceState,
      }),
      projectsDesktopTabs: false,
      onChatIdResolved,
    }
  )
  const draftKeyFor = (slot: string) =>
    organizationDraftKey(userId, organization.id, slot, { namespace: draftNamespace })
  const initialDraftKey = draftKeyFor(chatId ?? 'home')
  const draftKey = draftKeyFor(chat.resolvedChatId ?? chatId ?? 'home')
  const draftKeys = useMemo(() => [draftKey, initialDraftKey], [draftKey, initialDraftKey])
  const [initialDraft] = useState(() =>
    readDraft(useMothershipDraftsStore.getState().drafts, draftKeys)
  )
  const [restoredContexts, setRestoredContexts] = useState<ChatContext[]>(
    () => initialDraft?.contexts ?? []
  )
  useEffect(() => {
    useMothershipDraftsStore.getState().migrateDraft(initialDraftKey, draftKey)
  }, [initialDraftKey, draftKey])
  const hasChat = Boolean(chatId || chat.messages.length)
  const panel = useChatResourcePanel(chat, controller, userId)
  const addResource = panel.addResourceFromUser
  const selectResource = async (ref: WorkspaceResourceRef) => {
    if (!ref.workspaceId) {
      toast.error('This resource has no workspace address.')
      return
    }
    const destination = window.open('about:blank', '_blank')
    if (!destination) {
      toast.error('Allow pop-ups to open this resource in Sim.')
      return
    }
    destination.opener = null
    try {
      const host = await requestJson(getWorkspaceHostContextContract, {
        params: { id: ref.workspaceId },
      })
      if (host.hostOrganizationId !== organization.id) {
        destination.close()
        toast.error('This resource is outside this organization.')
        return
      }
      const resource = await fetchWorkspaceResourceRef(queryClient, ref.workspaceId, ref)
      if (!resource) {
        destination.close()
        toast.error(`Couldn't find "${ref.title}" in its workspace`)
        return
      }
      const kind =
        resource.type === 'knowledgebase'
          ? 'knowledge'
          : resource.type === 'filefolder'
            ? 'folder'
            : resource.type
      destination.location.replace(
        isWorkspaceResourceKind(kind)
          ? workspaceResourcePath(ref.workspaceId, kind, resource.id)
          : `${organizationRoutes(organization.id).home}?${new URLSearchParams({ resource: resource.id })}`
      )
    } catch {
      destination.close()
      toast.error(`Couldn't open "${ref.title}". Check your access and try again.`)
    }
  }
  const submission = useComposerSubmission({ mode: requestMode })
  const files = useFileAttachments({
    fileDropTarget,
    disabled: submission.pending,
    userId,
    organizationId: organization.id,
    requestMode,
    initialAttachments: initialDraft?.fileAttachments,
  })
  useEffect(() => {
    const store = useMothershipDraftsStore.getState()
    const fileAttachments = toApiAttachments(files.attachedFiles.filter((file) => !file.uploading))
    store.setDraft(draftKey, {
      ...(store.drafts[draftKey] ?? { text: '' }),
      fileAttachments,
    })
  }, [draftKey, files.attachedFiles])
  useEffect(() => {
    if (chat.error) toast.error(chat.error)
  }, [chat.error])
  const { recordQuery } = useSearchHistoryActions()
  const { sendMessage } = chat
  const { mutate: markRead } = useMarkMothershipChatRead({ organizationId: organization.id })

  useEffect(() => {
    if (chat.resolvedChatId && !chat.isSending && !chat.isReconnecting)
      markRead(chat.resolvedChatId)
  }, [chat.resolvedChatId, chat.isSending, chat.isReconnecting, markRead])

  const send = (
    message: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[],
    assistantSearch?: WorkspaceSearchFilters
  ) => {
    if (!scopeKnown) return
    if (requestMode === 'assistant') recordQuery(message)
    void sendMessage(
      message,
      fileAttachments,
      contexts,
      chatSendOptions(requestMode, assistantSearch)
    )
  }
  const submit = (text: string, contexts?: ChatContext[]) => {
    if (!scopeKnown || files.attachedFiles.some((file) => file.uploading)) return false
    if (requestMode === 'assistant') {
      if (files.attachedFiles.some((file) => !isAssistantImageType(file.type))) {
        toast.error('Remove unsupported files to use Assistant.')
        return false
      }
      try {
        assertMultiFileUploadAdmission(files.attachedFiles, {
          maxFiles: ASSISTANT_IMAGE_MAX_COUNT,
          maxFileBytes: ASSISTANT_IMAGE_MAX_BYTES,
          maxTotalBytes: ASSISTANT_IMAGE_MAX_TOTAL_BYTES,
        })
      } catch (error) {
        toast.error(getErrorMessage(error, 'Check the attached images before sending.'))
        return false
      }
    }
    const attachments = toApiAttachments(files.attachedFiles)
    const commit = ({
      message,
      contexts: preparedContexts,
    }: {
      message: string
      contexts?: ChatContext[]
    }) => {
      if (!message && !attachments.length) return false
      useMothershipDraftsStore.getState().clearDraft(draftKey)
      send(message, attachments.length ? attachments : undefined, preparedContexts)
      onSubmitted()
      setRestoredContexts([])
      files.clearAttachedFiles()
    }
    return prepareSubmission(text.trim(), contexts, commit)
  }

  const stopGeneration = () => {
    void chat.stopGeneration()
  }
  const composerProps: ConversationComposerProps = {
    requestMode,
    submission,
    onPlanChange:
      !hasChat && destinationMode === 'agent' && planEnabled
        ? () => setPlanning((value) => !value)
        : undefined,
    draftKeys,
    restoredContexts,
    messages: chat.messages,
    files,
    isSending: chat.isSending || chat.isReconnecting,
    onSubmit: submit,
    onStop: stopGeneration,
  }
  const threadProps = {
    onViewSources: (messageId: string, requestId?: string) =>
      addResource({
        type: 'sources',
        id: 'cited-sources',
        title: 'Sources',
        sources: { messageId, ...(requestId ? { requestId } : {}) },
      }),
    messages: chat.messages,
    isSending: chat.isSending,
    isReconnecting: chat.isReconnecting,
    isLoading: Boolean(chatId) && !chat.messages.length && chat.isChatHistoryPending,
    onSubmit: send,
    onStopGeneration: stopGeneration,
    onRetryMessage: chat.retryMessage,
    onDismissMessage: chat.dismissMessage,
    userId,
    chatId: chat.resolvedChatId,
    onWorkspaceResourceSelect: requestMode !== 'assistant' ? selectResource : undefined,
    reserveResourceHeader: chat.resources.length > 0 || requestMode !== 'assistant',
  }
  const reviewProps = {
    organizationId: organization.id,
    chatId: chat.resolvedChatId,
    messages: chat.messages,
    active: chat.isSending,
    enabled: requestMode === 'assistant',
  }
  return {
    chat,
    controller,
    hasChat,
    composerProps,
    threadProps,
    reviewProps,
  }
}
