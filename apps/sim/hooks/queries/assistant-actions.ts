import { useCallback } from 'react'
import { compareStrings } from '@sim/utils/string'
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AssistantActionDecisionBody,
  type AssistantActionReceiptsResponse,
  decideAssistantActionContract,
  listAssistantActionReceiptsContract,
  listAssistantActionsContract,
  readAssistantToolPermissionsContract,
  type UpdateAssistantToolPermissionsBody,
  updateAssistantToolPermissionsContract,
} from '@/lib/api/contracts/assistant-actions'

export const assistantActionKeys = {
  all: ['assistant-actions'] as const,
  permissions: () => [...assistantActionKeys.all, 'permissions'] as const,
  permission: (organizationId: string, credentialId: string) =>
    [...assistantActionKeys.permissions(), organizationId, credentialId] as const,
  review: (organizationId: string, chatId: string) =>
    [...assistantActionKeys.all, 'review', organizationId, chatId] as const,
  receipts: (organizationId: string, chatId: string) =>
    [...assistantActionKeys.all, 'receipts', organizationId, chatId] as const,
  turnReceipts: (organizationId: string, chatId: string, streamId: string) =>
    [...assistantActionKeys.receipts(organizationId, chatId), 'turn', streamId] as const,
  receiptBatches: (organizationId: string, chatId: string, streamId: string) =>
    [...assistantActionKeys.receipts(organizationId, chatId), 'batches', streamId] as const,
  receiptBatch: (organizationId: string, chatId: string, streamId: string, toolCallIds: string[]) =>
    [...assistantActionKeys.receiptBatches(organizationId, chatId, streamId), toolCallIds] as const,
}

const ASSISTANT_PERMISSIONS_STALE_TIME = 10_000
const ASSISTANT_REVIEW_STALE_TIME = 3_000
const ASSISTANT_REVIEW_POLL_INTERVAL = 3_000
const RECEIPT_BATCH_CONCURRENCY = 2

export function useAssistantToolPermissions(organizationId: string, credentialId: string) {
  return useQuery({
    queryKey: assistantActionKeys.permission(organizationId, credentialId),
    queryFn: ({ signal }) =>
      requestJson(readAssistantToolPermissionsContract, {
        params: { id: organizationId, credentialId },
        signal,
      }),
    enabled: Boolean(organizationId && credentialId),
    staleTime: ASSISTANT_PERMISSIONS_STALE_TIME,
  })
}

export function useAssistantActionReview(
  organizationId: string,
  chatId: string,
  active: boolean,
  enabled: boolean
) {
  return useQuery({
    queryKey: assistantActionKeys.review(organizationId, chatId),
    queryFn: ({ signal }) =>
      requestJson(listAssistantActionsContract, {
        params: { id: organizationId, chatId },
        query: {},
        signal,
      }),
    enabled: enabled && Boolean(organizationId && chatId),
    staleTime: ASSISTANT_REVIEW_STALE_TIME,
    refetchInterval: (query) =>
      active || query.state.data?.actions.length ? ASSISTANT_REVIEW_POLL_INTERVAL : false,
  })
}

export function useDecideAssistantAction(organizationId: string, chatId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      toolCallId,
      signal,
      ...body
    }: AssistantActionDecisionBody & { toolCallId: string; signal?: AbortSignal }) =>
      requestJson(decideAssistantActionContract, {
        params: { id: organizationId, chatId, toolCallId },
        body,
        signal,
      }),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: assistantActionKeys.review(organizationId, chatId) }),
        client.invalidateQueries({
          queryKey: assistantActionKeys.receipts(organizationId, chatId),
          refetchType: 'none',
        }),
      ]),
  })
}

interface ReceiptTurnOptions {
  organizationId: string
  chatId: string
  streamId: string
  enabled: boolean
  mountedTurnCount: number
}

interface ReceiptBatchOptions extends ReceiptTurnOptions {
  candidateIds: Iterable<string>
  coveredIds: ReadonlySet<string>
  pageCount: number
}

/** Pages only mounted turns; an unresolved execution keeps polling after chat streaming stops. */
export function useAssistantActionTurnReceipts({
  organizationId,
  chatId,
  streamId,
  active,
  enabled,
  mountedTurnCount,
}: ReceiptTurnOptions & { active: boolean }) {
  const client = useQueryClient()
  return useInfiniteQuery({
    queryKey: assistantActionKeys.turnReceipts(organizationId, chatId, streamId),
    queryFn: ({ signal, pageParam }) =>
      requestJson(listAssistantActionReceiptsContract, {
        params: { id: organizationId, chatId },
        query: { streamId, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && Boolean(organizationId && chatId && streamId),
    staleTime: ASSISTANT_REVIEW_STALE_TIME,
    refetchInterval: (query) =>
      enabled &&
      (active ||
        query.state.data?.pages.some((page) => page.receipts.some((receipt) => receipt.unsettled)))
        ? receiptPollInterval(
            client,
            organizationId,
            chatId,
            streamId,
            query.state.data?.pages.length ?? 1,
            mountedTurnCount
          )
        : false,
  })
}

/** Immutable batch keys retain recovery-only receipts after a decision removes the pending action. */
export function useAssistantActionReceiptBatches({
  organizationId,
  chatId,
  streamId,
  candidateIds,
  coveredIds,
  enabled,
  pageCount,
  mountedTurnCount,
}: ReceiptBatchOptions) {
  const client = useQueryClient()
  const existing = client.getQueriesData<AssistantActionReceiptsResponse>({
    queryKey: assistantActionKeys.receiptBatches(organizationId, chatId, streamId),
  })
  const batches = existing.flatMap(([key]) => {
    const ids = key.at(-1)
    return Array.isArray(ids) && ids.every((id): id is string => typeof id === 'string')
      ? [ids]
      : []
  })
  const known = new Set([...coveredIds, ...batches.flat()])
  const missing = [...new Set(candidateIds)].filter((id) => !known.has(id)).sort(compareStrings)
  for (let index = 0; index < missing.length; index += 32)
    batches.push(missing.slice(index, index + 32))
  const interval = receiptPollInterval(
    client,
    organizationId,
    chatId,
    streamId,
    pageCount,
    mountedTurnCount
  )
  let initialRequests = 0
  const queries = useQueries({
    queries: batches.map((toolCallIds) => {
      const key = assistantActionKeys.receiptBatch(organizationId, chatId, streamId, toolCallIds)
      const state = client.getQueryState(key)
      const started = state?.status === 'success' || state?.status === 'error'
      const uncovered = toolCallIds.some((id) => !coveredIds.has(id))
      const eligible = started || (uncovered && initialRequests++ < RECEIPT_BATCH_CONCURRENCY)
      return {
        queryKey: key,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          requestJson(listAssistantActionReceiptsContract, {
            params: { id: organizationId, chatId },
            query: { toolCallIds },
            signal,
          }),
        enabled: enabled && eligible && Boolean(organizationId && chatId && streamId) && uncovered,
        staleTime: ASSISTANT_REVIEW_STALE_TIME,
        refetchInterval:
          enabled &&
          uncovered &&
          existing
            .find(([key]) => key.at(-1) === toolCallIds)?.[1]
            ?.receipts.some((receipt) => receipt.unsettled && !coveredIds.has(receipt.toolCallId))
            ? interval
            : false,
      }
    }),
  })
  return batches.map((ids, index) => ({ ids, query: queries[index] }))
}

/** A review batch refreshes receipts once, after all of its decisions settle. */
export function useRefreshAssistantActionReceipts(organizationId: string, chatId: string) {
  const client = useQueryClient()
  return useCallback(
    () =>
      client.invalidateQueries({ queryKey: assistantActionKeys.receipts(organizationId, chatId) }),
    [client, organizationId, chatId]
  )
}

function receiptPollInterval(
  client: QueryClient,
  organizationId: string,
  chatId: string,
  streamId: string,
  pageCount: number,
  mountedTurnCount: number
) {
  const pages = client.getQueryData<InfiniteData<AssistantActionReceiptsResponse>>(
    assistantActionKeys.turnReceipts(organizationId, chatId, streamId)
  )
  const covered = new Set(
    pages?.pages.flatMap((page) => page.receipts.map((receipt) => receipt.toolCallId))
  )
  const batches = client
    .getQueriesData<AssistantActionReceiptsResponse>({
      queryKey: assistantActionKeys.receiptBatches(organizationId, chatId, streamId),
    })
    .filter(([, data]) =>
      data?.receipts.some((receipt) => receipt.unsettled && !covered.has(receipt.toolCallId))
    ).length
  return Math.max(
    ASSISTANT_REVIEW_POLL_INTERVAL,
    (pageCount + batches) * Math.max(1, mountedTurnCount) * 1_000
  )
}

export function useUpdateAssistantToolPermissions(organizationId: string, credentialId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAssistantToolPermissionsBody) =>
      requestJson(updateAssistantToolPermissionsContract, {
        params: { id: organizationId, credentialId },
        body,
      }),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: assistantActionKeys.permission(organizationId, credentialId),
      }),
    onError: () =>
      client.invalidateQueries({
        queryKey: assistantActionKeys.permission(organizationId, credentialId),
      }),
  })
}
