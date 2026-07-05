import { isRecordLike } from '@sim/utils/object'
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  addMothershipChatResourceContract,
  createMothershipChatContract,
  deleteMothershipChatContract,
  forkMothershipChatContract,
  getMothershipChatContract,
  listMothershipChatsContract,
  type MothershipChat,
  removeMothershipChatResourceContract,
  reorderMothershipChatResourcesContract,
  updateMothershipChatContract,
} from '@/lib/api/contracts/mothership-chats'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import { normalizeMessage } from '@/lib/copilot/chat/persisted-message'
import {
  type FilePreviewSession,
  isFilePreviewSession,
} from '@/lib/copilot/request/session/file-preview-session-contract'
import { isStreamBatchEvent, type StreamBatchEvent } from '@/lib/copilot/request/session/types'
import { type MothershipResource, MothershipResourceType } from '@/lib/copilot/resources/types'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'

export interface MothershipChatMetadata {
  id: string
  name: string
  updatedAt: Date
  isActive: boolean
  isUnread: boolean
  isPinned: boolean
}

export interface MothershipChatHistory {
  id: string
  title: string | null
  messages: PersistedMessage[]
  activeStreamId: string | null
  resources: MothershipResource[]
  streamSnapshot?: {
    events: StreamBatchEvent[]
    previewSessions: FilePreviewSession[]
    status: string
  } | null
}

export const mothershipChatKeys = {
  all: ['mothership-chats'] as const,
  lists: () => [...mothershipChatKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined) =>
    [...mothershipChatKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...mothershipChatKeys.all, 'detail'] as const,
  detail: (chatId: string | undefined) => [...mothershipChatKeys.details(), chatId ?? ''] as const,
}

/** Shared by the `useMothershipChats` hook and the workspace sidebar prefetch. */
export const MOTHERSHIP_CHAT_LIST_STALE_TIME = 60 * 1000
export const MOTHERSHIP_CHAT_HISTORY_STALE_TIME = 30 * 1000

function assertValid(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isResourceType(value: unknown): value is MothershipResource['type'] {
  return (
    typeof value === 'string' &&
    Object.values(MothershipResourceType).some((type) => type === value)
  )
}

function parseStreamSnapshot(value: unknown): MothershipChatHistory['streamSnapshot'] {
  if (!isRecordLike(value)) {
    return null
  }

  const rawEvents = Array.isArray(value.events) ? value.events : []
  const events: StreamBatchEvent[] = []
  for (const entry of rawEvents) {
    if (!isStreamBatchEvent(entry)) {
      return null
    }
    events.push(entry)
  }

  const rawPreviewSessions = Array.isArray(value.previewSessions) ? value.previewSessions : []
  const previewSessions: FilePreviewSession[] = []
  for (const session of rawPreviewSessions) {
    if (!isFilePreviewSession(session)) {
      return null
    }
    previewSessions.push(session)
  }

  return {
    events,
    previewSessions,
    status: typeof value.status === 'string' ? value.status : 'unknown',
  }
}

function normalizeMessages(value: unknown): PersistedMessage[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isRecordLike).map((message) => normalizeMessage(message))
}

function parseResource(value: unknown, context: string): MothershipResource {
  assertValid(isRecordLike(value), `${context} must be an object`)
  assertValid(isResourceType(value.type), `${context}.type is invalid`)
  assertValid(typeof value.id === 'string', `${context}.id must be a string`)
  assertValid(typeof value.title === 'string', `${context}.title must be a string`)

  return {
    type: value.type,
    id: value.id,
    title: value.title,
  }
}

function parseResources(value: unknown, context: string): MothershipResource[] {
  assertValid(Array.isArray(value), `${context} must be an array`)

  return value.map((resource, index) => parseResource(resource, `${context}[${index}]`))
}

function parseStrictStreamSnapshot(
  value: unknown,
  context: string
): MothershipChatHistory['streamSnapshot'] {
  if (value === undefined || value === null) {
    return null
  }

  const snapshot = parseStreamSnapshot(value)
  assertValid(snapshot !== null, `${context} is invalid`)
  return snapshot
}

function parseChatHistory(value: unknown): MothershipChatHistory {
  const responseContext = 'Invalid chat response'
  const chatContext = `${responseContext}: chat`

  assertValid(isRecordLike(value), `${responseContext}: body must be an object`)
  assertValid(isRecordLike(value.chat), `${chatContext} must be an object`)

  const chat = value.chat

  assertValid(typeof chat.id === 'string', `${chatContext}.id must be a string`)
  assertValid(isNullableString(chat.title), `${chatContext}.title must be a string or null`)
  assertValid(Array.isArray(chat.messages), `${chatContext}.messages must be an array`)
  assertValid(
    isNullableString(chat.activeStreamId),
    `${chatContext}.activeStreamId must be a string or null`
  )

  return {
    id: chat.id,
    title: chat.title,
    messages: normalizeMessages(chat.messages),
    activeStreamId: chat.activeStreamId,
    resources: parseResources(chat.resources, `${chatContext}.resources`),
    streamSnapshot: parseStrictStreamSnapshot(chat.streamSnapshot, `${chatContext}.streamSnapshot`),
  }
}

function parseChatResourcesResponse(value: unknown): { resources: MothershipResource[] } {
  assertValid(isRecordLike(value), 'Invalid chat resources response: body must be an object')

  return {
    resources: parseResources(value.resources, 'Invalid chat resources response: resources'),
  }
}

export function mapChat(chat: MothershipChat): MothershipChatMetadata {
  const updatedAt = new Date(chat.updatedAt)
  return {
    id: chat.id,
    name: chat.title ?? 'New chat',
    updatedAt,
    isActive: chat.activeStreamId !== null,
    isUnread:
      chat.activeStreamId === null &&
      (chat.lastSeenAt === null || updatedAt > new Date(chat.lastSeenAt)),
    isPinned: chat.pinned,
  }
}

export async function fetchMothershipChats(
  workspaceId: string,
  signal?: AbortSignal
): Promise<MothershipChatMetadata[]> {
  const data = await requestJson(listMothershipChatsContract, {
    query: { workspaceId },
    signal,
  })
  return data.data.map(mapChat)
}

/**
 * Fetches mothership chat chats for a workspace.
 * These are workspace-scoped conversations from the Home page.
 */
export function useMothershipChats(workspaceId?: string) {
  return useQuery({
    queryKey: mothershipChatKeys.list(workspaceId),
    queryFn: workspaceId ? ({ signal }) => fetchMothershipChats(workspaceId, signal) : skipToken,
    placeholderData: keepPreviousData,
    staleTime: MOTHERSHIP_CHAT_LIST_STALE_TIME,
  })
}

export async function fetchMothershipChatHistory(
  chatId: string,
  signal?: AbortSignal
): Promise<MothershipChatHistory> {
  try {
    const data = await requestJson(getMothershipChatContract, {
      params: { chatId },
      signal,
    })
    return parseChatHistory(data)
  } catch (error) {
    if (!isApiClientError(error)) throw error
    // Fall through to the legacy copilot-shape alias on any HTTP error (typically 404
    // when the chat lives in the older copilot table and isn't a mothership-typed row).
  }

  // boundary-raw-fetch: legacy alias path /api/mothership/chat?chatId=... returns the
  // copilot lifecycle shape (activeStreamId, not conversationId) for chats stored under
  // the older copilot table; no contract exists for this alias path
  const copilotRes = await fetch(`/api/mothership/chat?chatId=${encodeURIComponent(chatId)}`, {
    signal,
  })

  if (!copilotRes.ok) {
    throw new Error('Failed to load chat')
  }

  return parseChatHistory(await copilotRes.json())
}

/**
 * Fetches chat history for a single chat (mothership chat).
 * Used by the chat page to load an existing conversation.
 */
export function useMothershipChatHistory(chatId: string | undefined) {
  return useQuery({
    queryKey: mothershipChatKeys.detail(chatId),
    queryFn: chatId ? ({ signal }) => fetchMothershipChatHistory(chatId, signal) : skipToken,
    staleTime: MOTHERSHIP_CHAT_HISTORY_STALE_TIME,
  })
}

async function deleteChat(chatId: string): Promise<void> {
  await requestJson(deleteMothershipChatContract, {
    params: { chatId },
  })
}

/**
 * Deletes a mothership chat chat and invalidates the chat list.
 */
export function useDeleteMothershipChat(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteChat,
    onSettled: (_data, _error, chatId) => {
      queryClient.invalidateQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
      queryClient.removeQueries({ queryKey: mothershipChatKeys.detail(chatId) })
      useMothershipQueueStore.getState().clearChat(chatId)
    },
  })
}

/**
 * Deletes multiple mothership chat chats and invalidates the chat list.
 */
export function useDeleteMothershipChats(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (chatIds: string[]) => {
      await Promise.all(chatIds.map(deleteChat))
    },
    onSettled: (_data, _error, chatIds) => {
      queryClient.invalidateQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
      const queueStore = useMothershipQueueStore.getState()
      for (const chatId of chatIds) {
        queryClient.removeQueries({ queryKey: mothershipChatKeys.detail(chatId) })
        queueStore.clearChat(chatId)
      }
    },
  })
}

async function renameChat({ chatId, title }: { chatId: string; title: string }): Promise<void> {
  await requestJson(updateMothershipChatContract, {
    params: { chatId },
    body: { title },
  })
}

/**
 * Renames a mothership chat chat with optimistic update.
 */
export function useRenameMothershipChat(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: renameChat,
    onMutate: async ({ chatId, title }) => {
      await queryClient.cancelQueries({ queryKey: mothershipChatKeys.list(workspaceId) })

      const previousChats = queryClient.getQueryData<MothershipChatMetadata[]>(
        mothershipChatKeys.list(workspaceId)
      )

      queryClient.setQueryData<MothershipChatMetadata[]>(
        mothershipChatKeys.list(workspaceId),
        (old) => old?.map((chat) => (chat.id === chatId ? { ...chat, name: title } : chat))
      )

      return { previousChats }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousChats) {
        queryClient.setQueryData(mothershipChatKeys.list(workspaceId), context.previousChats)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
      queryClient.invalidateQueries({ queryKey: mothershipChatKeys.detail(variables.chatId) })
    },
  })
}

async function addChatResource(params: {
  chatId: string
  resource: MothershipResource
}): Promise<{ resources: MothershipResource[] }> {
  const data = await requestJson(addMothershipChatResourceContract, {
    body: { chatId: params.chatId, resource: params.resource },
  })
  return parseChatResourcesResponse(data)
}

export function useAddChatResource(chatId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: addChatResource,
    onMutate: async ({ resource }) => {
      if (!chatId) return
      await queryClient.cancelQueries({ queryKey: mothershipChatKeys.detail(chatId) })
      const previous = queryClient.getQueryData<MothershipChatHistory>(
        mothershipChatKeys.detail(chatId)
      )
      if (previous) {
        const exists = previous.resources.some(
          (r) => r.type === resource.type && r.id === resource.id
        )
        if (!exists) {
          queryClient.setQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId), {
            ...previous,
            resources: [...previous.resources, resource],
          })
        }
      }
      return { previous }
    },
    onError: (_err, _variables, context) => {
      if (context?.previous && chatId) {
        queryClient.setQueryData(mothershipChatKeys.detail(chatId), context.previous)
      }
    },
    onSettled: () => {
      if (chatId) {
        queryClient.invalidateQueries({ queryKey: mothershipChatKeys.detail(chatId) })
      }
    },
  })
}

async function reorderChatResources(params: {
  chatId: string
  resources: MothershipResource[]
}): Promise<{ resources: MothershipResource[] }> {
  const data = await requestJson(reorderMothershipChatResourcesContract, {
    body: { chatId: params.chatId, resources: params.resources },
  })
  return parseChatResourcesResponse(data)
}

export function useReorderChatResources(chatId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: reorderChatResources,
    onMutate: async ({ resources }) => {
      if (!chatId) return
      await queryClient.cancelQueries({ queryKey: mothershipChatKeys.detail(chatId) })
      const previous = queryClient.getQueryData<MothershipChatHistory>(
        mothershipChatKeys.detail(chatId)
      )
      if (previous) {
        queryClient.setQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId), {
          ...previous,
          resources,
        })
      }
      return { previous }
    },
    onError: (_err, _variables, context) => {
      if (context?.previous && chatId) {
        queryClient.setQueryData(mothershipChatKeys.detail(chatId), context.previous)
      }
    },
    onSettled: () => {
      if (chatId) {
        queryClient.invalidateQueries({ queryKey: mothershipChatKeys.detail(chatId) })
      }
    },
  })
}

async function removeChatResource(params: {
  chatId: string
  resourceType: string
  resourceId: string
}): Promise<{ resources: MothershipResource[] }> {
  const data = await requestJson(removeMothershipChatResourceContract, {
    body: params,
  })
  return parseChatResourcesResponse(data)
}

export function useRemoveChatResource(chatId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: removeChatResource,
    onMutate: async ({ resourceType, resourceId }) => {
      if (!chatId) return
      await queryClient.cancelQueries({ queryKey: mothershipChatKeys.detail(chatId) })
      const removed: MothershipChatHistory['resources'] = []
      queryClient.setQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId), (prev) => {
        if (!prev) return prev
        const next: MothershipChatHistory['resources'] = []
        for (const r of prev.resources) {
          if (r.type === resourceType && r.id === resourceId) removed.push(r)
          else next.push(r)
        }
        return removed.length > 0 ? { ...prev, resources: next } : prev
      })
      return { removed }
    },
    onError: (_err, _variables, context) => {
      if (!chatId || !context?.removed.length) return
      queryClient.setQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId), (prev) =>
        prev ? { ...prev, resources: [...prev.resources, ...context.removed] } : prev
      )
    },
    onSettled: () => {
      if (chatId) {
        queryClient.invalidateQueries({ queryKey: mothershipChatKeys.detail(chatId) })
      }
    },
  })
}

async function markChatRead(chatId: string): Promise<void> {
  await requestJson(updateMothershipChatContract, {
    params: { chatId },
    body: { isUnread: false },
  })
}

async function markChatUnread(chatId: string): Promise<void> {
  await requestJson(updateMothershipChatContract, {
    params: { chatId },
    body: { isUnread: true },
  })
}

function applyUnreadFlag(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | undefined,
  chatId: string,
  isUnread: boolean
): void {
  const current = queryClient.getQueryData<MothershipChatMetadata[]>(
    mothershipChatKeys.list(workspaceId)
  )
  if (!current) return
  queryClient.setQueryData<MothershipChatMetadata[]>(
    mothershipChatKeys.list(workspaceId),
    current.map((chat) => (chat.id === chatId ? { ...chat, isUnread } : chat))
  )
}

/**
 * Marks a chat as read with optimistic update.
 *
 * The server only updates `lastSeenAt`, never `updatedAt`, so we deliberately
 * do not invalidate the list cache — that would trigger a refetch that can
 * reorder the sidebar if any unrelated server-side update landed in between.
 *
 * If there is no cached list yet (initial fetch still in flight, e.g. on
 * chat-page refresh), we skip cancellation entirely so the in-flight fetch
 * can resolve normally — otherwise it would be orphaned and never refetched.
 * `onSuccess` then reconciles whichever state the fetch produced.
 */
export function useMarkMothershipChatRead(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markChatRead,
    onMutate: async (chatId) => {
      const previousChats = queryClient.getQueryData<MothershipChatMetadata[]>(
        mothershipChatKeys.list(workspaceId)
      )
      if (!previousChats) return { previousChats }

      await queryClient.cancelQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
      applyUnreadFlag(queryClient, workspaceId, chatId, false)

      return { previousChats }
    },
    onSuccess: (_data, chatId) => {
      applyUnreadFlag(queryClient, workspaceId, chatId, false)
    },
    onError: (_err, _variables, context) => {
      if (context?.previousChats) {
        queryClient.setQueryData(mothershipChatKeys.list(workspaceId), context.previousChats)
      }
    },
  })
}

/**
 * Marks a chat as unread with optimistic update.
 *
 * Same rationale as `useMarkMothershipChatRead` — no list invalidation, since the server
 * only flips `lastSeenAt` and the optimistic update fully reflects the change.
 */
export function useMarkMothershipChatUnread(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markChatUnread,
    onMutate: async (chatId) => {
      const previousChats = queryClient.getQueryData<MothershipChatMetadata[]>(
        mothershipChatKeys.list(workspaceId)
      )
      if (!previousChats) return { previousChats }

      await queryClient.cancelQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
      applyUnreadFlag(queryClient, workspaceId, chatId, true)

      return { previousChats }
    },
    onSuccess: (_data, chatId) => {
      applyUnreadFlag(queryClient, workspaceId, chatId, true)
    },
    onError: (_err, _variables, context) => {
      if (context?.previousChats) {
        queryClient.setQueryData(mothershipChatKeys.list(workspaceId), context.previousChats)
      }
    },
  })
}

async function setChatPinned({
  chatId,
  pinned,
}: {
  chatId: string
  pinned: boolean
}): Promise<void> {
  await requestJson(updateMothershipChatContract, {
    params: { chatId },
    body: { pinned },
  })
}

/**
 * Pins or unpins a chat with optimistic update. Pinned chats are sorted to
 * the top of the list by the server; the optimistic reducer preserves that
 * ordering by partitioning pinned and unpinned chats while keeping each
 * partition in its existing order (server returns desc(updatedAt) within).
 */
export function useSetMothershipChatPinned(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setChatPinned,
    onMutate: async ({ chatId, pinned }) => {
      await queryClient.cancelQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
      const previousChats = queryClient.getQueryData<MothershipChatMetadata[]>(
        mothershipChatKeys.list(workspaceId)
      )
      if (!previousChats) return { previousChats: undefined }

      const updated = previousChats.map((chat) =>
        chat.id === chatId ? { ...chat, isPinned: pinned } : chat
      )
      const pinnedChats = updated.filter((chat) => chat.isPinned)
      const unpinnedChats = updated.filter((chat) => !chat.isPinned)
      queryClient.setQueryData<MothershipChatMetadata[]>(mothershipChatKeys.list(workspaceId), [
        ...pinnedChats,
        ...unpinnedChats,
      ])

      return { previousChats }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousChats) {
        queryClient.setQueryData(mothershipChatKeys.list(workspaceId), context.previousChats)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
    },
  })
}

async function createChat(workspaceId: string): Promise<{ id: string }> {
  const { id } = await requestJson(createMothershipChatContract, { body: { workspaceId } })
  return { id }
}

export function useCreateMothershipChat(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => {
      if (!workspaceId) throw new Error('workspaceId is required')
      return createChat(workspaceId)
    },
    onSuccess: (data) => {
      if (!workspaceId) return
      const existing =
        queryClient.getQueryData<MothershipChatMetadata[]>(mothershipChatKeys.list(workspaceId)) ??
        []
      const newChat: MothershipChatMetadata = {
        id: data.id,
        name: 'New chat',
        updatedAt: new Date(),
        isActive: false,
        isUnread: false,
        isPinned: false,
      }
      const pinnedCount = existing.findIndex((chat) => !chat.isPinned)
      const insertAt = pinnedCount === -1 ? existing.length : pinnedCount
      queryClient.setQueryData<MothershipChatMetadata[]>(mothershipChatKeys.list(workspaceId), [
        ...existing.slice(0, insertAt),
        newChat,
        ...existing.slice(insertAt),
      ])
    },
    onSettled: () => {
      if (!workspaceId) return
      queryClient.invalidateQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
    },
  })
}

async function forkChat(params: {
  chatId: string
  upToMessageId: string
}): Promise<{ id: string }> {
  const data = await requestJson(forkMothershipChatContract, {
    params: { chatId: params.chatId },
    body: { upToMessageId: params.upToMessageId },
  })
  return { id: data.id }
}

export function useForkMothershipChat(workspaceId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: forkChat,
    onSuccess: async (data, variables) => {
      if (!workspaceId) return
      await queryClient.cancelQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
      const existing = queryClient.getQueryData<MothershipChatMetadata[]>(
        mothershipChatKeys.list(workspaceId)
      )
      if (existing) {
        const sourceChat = existing.find((t) => t.id === variables.chatId)
        const baseName = (sourceChat?.name ?? 'New chat').replace(/^Fork \| /, '')
        const optimisticChat: MothershipChatMetadata = {
          id: data.id,
          name: `Fork | ${baseName}`,
          updatedAt: new Date(),
          isActive: false,
          isUnread: false,
          isPinned: false,
        }
        const pinnedCount = existing.findIndex((chat) => !chat.isPinned)
        const insertAt = pinnedCount === -1 ? existing.length : pinnedCount
        queryClient.setQueryData<MothershipChatMetadata[]>(mothershipChatKeys.list(workspaceId), [
          ...existing.slice(0, insertAt),
          optimisticChat,
          ...existing.slice(insertAt),
        ])
      }
    },
    onSettled: () => {
      if (!workspaceId) return
      queryClient.invalidateQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
    },
  })
}
