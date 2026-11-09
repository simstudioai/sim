'use client'

import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@sim/emcn-legacy'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
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
import { BrowserStorage } from '@/lib/core/utils/browser-storage'
import { resourceParam, searchFilterParsers } from '@/lib/mothership/chat/search-params'
import type {
  ChatRequestMode,
  FileAttachmentForApi,
  WorkspaceResourceRef,
} from '@/lib/mothership/chat/types'
import { organizationRoutes } from '@/lib/navigation/paths'
import { organizationDraftKey, SEARCH_ASSISTANT_DRAFT_SLOT } from '@/lib/organizations/draft-key'
import { useOrganization } from '@/lib/organizations/provider'
import {
  type OrganizationSummaryRequest,
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
import type { ConversationComposerProps } from '@/app/_organization-conversation/composer'
import { getMothershipUseChatOptions, useChat } from '@/hooks/mothership-chat/use-chat'
import {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/hooks/mothership-chat/use-resource-panel'
import { useRestoredChatEntry } from '@/hooks/mothership-chat/use-restored-chat-entry'
import { useMarkMothershipChatRead } from '@/hooks/queries/mothership-chats'
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

/** Where the conversation runs: what differs beyond how it is drawn. */
type ConversationSurface =
  | {
      kind: 'page'
      /** Names this surface's new-chat draft, for a surface that must not share another's. */
      draftSlot?: string
    }
  | {
      kind: 'panel'
      draftNamespace: string
      fileDropTarget: RefObject<HTMLElement | null>
      onChatIdResolved: (chatId: string) => void
      prepareSubmission: PrepareChatSubmission
      onSubmitted: () => void
    }

interface UseConversationGateOptions {
  chatId?: string
  requestMode: ChatRequestMode
}

/** Whether the surface may mount, and for which identity. Its key remounts on any change to one. */
export function useConversationGate({ chatId, requestMode }: UseConversationGateOptions) {
  const { organization, viewer, searchAccess, canBuild, mothershipAvailable } = useOrganization()
  const isClient = useHydrated()
  const isRestoredChatEntry = useRestoredChatEntry({ chatId })
  if (
    !mothershipAvailable ||
    (requestMode === 'assistant' ? !searchAccess.memberScoped : !canBuild)
  )
    return { status: 'denied' } as const
  if (isRestoredChatEntry) return { status: 'restoring' } as const
  if (!isClient) return { status: 'waiting' } as const
  return {
    status: 'ready',
    instanceKey: `${viewer.userId}:${organization.id}:${chatId ?? 'new'}`,
  } as const
}

interface UseOrganizationConversationOptions {
  surface: ConversationSurface
  chatId?: string
  requestMode: ChatRequestMode
  active?: boolean
  summaryRequest?: OrganizationSummaryRequest
  onSummaryConsumed?: (id: string) => void
}

/**
 * An organization conversation's behavior: the chat, its drafts, attachments, submission, and
 * resources. Its two views draw it, the extension's panel and the page's. This module stays free of
 * the design system so the extension can bundle it.
 */
export function useOrganizationConversation({
  surface,
  chatId,
  requestMode: destinationMode,
  active = true,
  summaryRequest,
  onSummaryConsumed,
}: UseOrganizationConversationOptions) {
  const { organization, viewer, canBuild } = useOrganization()
  const panelSurface = surface.kind === 'panel' ? surface : null
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
  const chat = useChat({ organizationId: organization.id }, chatId, {
    ...getMothershipUseChatOptions({
      requestMode,
      getChatUrl:
        destinationMode === 'assistant'
          ? (id) =>
              serializeSearchConversation(organizationRoutes(organization.id).searchChat(id), {
                ...searchParams,
                mode: active ? 'assistant' : 'search',
                resource: controller.activeResourceState[0],
              })
          : undefined,
      onResourceEvent: controller.onResourceEvent,
      activeResourceState: controller.activeResourceState,
    }),
    ...(panelSurface
      ? { projectsDesktopTabs: false, onChatIdResolved: panelSurface.onChatIdResolved }
      : {}),
  })
  const newDraftSlot =
    surface.kind === 'panel'
      ? 'home'
      : (surface.draftSlot ??
        (destinationMode === 'assistant' ? SEARCH_ASSISTANT_DRAFT_SLOT : 'home'))
  const draftKeyFor = (slot: string) =>
    organizationDraftKey(userId, organization.id, slot, {
      namespace: panelSurface?.draftNamespace,
    })
  const initialDraftKey = draftKeyFor(chatId ?? newDraftSlot)
  const draftKey = draftKeyFor(chat.resolvedChatId ?? chatId ?? newDraftSlot)
  const [legacyDraftKey] = useState(() => {
    if (panelSurface || chatId) return null
    const key = organizationDraftKey(userId, organization.id, 'new')
    if (!useMothershipDraftsStore.getState().drafts[key]) return null
    const persisted = toRecord(BrowserStorage.getItem<unknown>('organization-chat-mode', null))
    const modes = toRecord(toRecord(persisted.state).modes)
    const legacyMode =
      !canBuild || modes[`${userId}:${organization.id}`] === 'assistant' ? 'assistant' : 'agent'
    return legacyMode === destinationMode ? key : null
  })
  const draftKeys = useMemo(
    () => [draftKey, initialDraftKey, ...(legacyDraftKey ? [legacyDraftKey] : [])],
    [draftKey, initialDraftKey, legacyDraftKey]
  )
  const [initialDraft] = useState(() =>
    readDraft(useMothershipDraftsStore.getState().drafts, draftKeys)
  )
  const [restoredContexts, setRestoredContexts] = useState<ChatContext[]>(
    () => initialDraft?.contexts ?? []
  )
  useEffect(() => {
    const store = useMothershipDraftsStore.getState()
    if (legacyDraftKey) store.migrateDraft(legacyDraftKey, initialDraftKey)
    store.migrateDraft(initialDraftKey, draftKey)
  }, [initialDraftKey, draftKey, legacyDraftKey])
  const hasChat = Boolean(chatId || chat.messages.length)
  const panel = useChatResourcePanel(chat, controller, userId)
  const addResource = panel.addResourceFromUser
  const selectResource = async (ref: WorkspaceResourceRef) => {
    if (!ref.workspaceId) {
      toast.error('This resource has no workspace address.')
      return
    }
    const destination = panelSurface ? window.open('about:blank', '_blank') : null
    if (panelSurface && !destination) {
      toast.error('Allow pop-ups to open this resource in Sim.')
      return
    }
    if (destination) destination.opener = null
    try {
      const host = await requestJson(getWorkspaceHostContextContract, {
        params: { id: ref.workspaceId },
      })
      if (host.hostOrganizationId !== organization.id) {
        destination?.close()
        toast.error('This resource is outside this organization.')
        return
      }
      const resource = await fetchWorkspaceResourceRef(queryClient, ref.workspaceId, ref)
      if (!resource) {
        destination?.close()
        toast.error(`Couldn't find "${ref.title}" in its workspace`)
        return
      }
      if (destination) {
        const kind =
          resource.type === 'knowledgebase'
            ? 'knowledge'
            : resource.type === 'filefolder'
              ? 'folder'
              : resource.type
        destination.location.replace(
          isWorkspaceResourceKind(kind)
            ? workspaceResourcePath(ref.workspaceId, kind, resource.id)
            : `/workspace/${encodeURIComponent(ref.workspaceId)}/home?resource=${encodeURIComponent(resource.id)}`
        )
      } else addResource({ ...resource, workspaceId: ref.workspaceId })
    } catch {
      destination?.close()
      toast.error(`Couldn't open "${ref.title}". Check your access and try again.`)
    }
  }
  const submission = useComposerSubmission({ mode: requestMode })
  const files = useFileAttachments({
    fileDropTarget: panelSurface?.fileDropTarget,
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
    if (active && chat.resolvedChatId && !chat.isSending && !chat.isReconnecting)
      markRead(chat.resolvedChatId)
  }, [active, chat.resolvedChatId, chat.isSending, chat.isReconnecting, markRead])

  const consumedSummary = useRef<string | null>(null)
  useEffect(() => {
    if (!active || !summaryRequest || consumedSummary.current === summaryRequest.id) return
    consumedSummary.current = summaryRequest.id
    onSummaryConsumed?.(summaryRequest.id)
    void sendMessage(
      summaryRequest.message,
      undefined,
      undefined,
      chatSendOptions('assistant', summaryRequest.assistantSearch)
    )
  }, [active, summaryRequest, onSummaryConsumed, sendMessage])

  const send = (
    message: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[],
    assistantSearch?: WorkspaceSearchFilters
  ) => {
    if (requestMode !== 'assistant' && !canBuild) return
    if (requestMode === 'assistant') recordQuery(message)
    if (requestMode !== 'assistant' && !panelSurface) panel.prepareResourceViewForAgentTurn()
    void sendMessage(
      message,
      fileAttachments,
      contexts,
      chatSendOptions(requestMode, assistantSearch)
    )
  }
  const submit = (text: string, contexts?: ChatContext[]) => {
    if (files.attachedFiles.some((file) => file.uploading)) return false
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
      panelSurface?.onSubmitted()
      setRestoredContexts([])
      files.clearAttachedFiles()
    }
    return panelSurface
      ? panelSurface.prepareSubmission(text.trim(), contexts, commit)
      : commit({ message: text.trim(), contexts })
  }

  const allowBuildControls = requestMode !== 'assistant' && canBuild
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
    isInitialView: !hasChat,
    isSending: chat.isSending || chat.isReconnecting,
    onSubmit: submit,
    onStop: stopGeneration,
  }
  /** What both views' threads take; each adds its own layout around them. */
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
    reserveResourceHeader: chat.resources.length > 0 || allowBuildControls,
  }
  const reviewProps = {
    organizationId: organization.id,
    chatId: chat.resolvedChatId,
    messages: chat.messages,
    active: chat.isSending,
    enabled: requestMode === 'assistant',
  }
  return {
    organization,
    chat,
    controller,
    panel,
    hasChat,
    requestMode,
    allowBuildControls,
    searchParams,
    send,
    composerProps,
    threadProps,
    reviewProps,
  }
}
