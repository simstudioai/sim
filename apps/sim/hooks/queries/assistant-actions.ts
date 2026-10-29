import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AssistantActionDecisionBody,
  decideAssistantActionContract,
  listAssistantActionsContract,
  readAssistantToolPermissionsContract,
  type UpdateAssistantToolPermissionsBody,
  updateAssistantToolPermissionsContract,
} from '@/lib/api/contracts/assistant-actions'

const assistantActionKeys = {
  all: ['assistant-actions'] as const,
  permissions: () => [...assistantActionKeys.all, 'permissions'] as const,
  permission: (organizationId: string, credentialId: string) =>
    [...assistantActionKeys.permissions(), organizationId, credentialId] as const,
  review: (organizationId: string, chatId: string) =>
    [...assistantActionKeys.all, 'review', organizationId, chatId] as const,
}

const ASSISTANT_PERMISSIONS_STALE_TIME = 10_000
const ASSISTANT_REVIEW_STALE_TIME = 3_000
const ASSISTANT_REVIEW_POLL_INTERVAL = 3_000

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
    mutationFn: ({ toolCallId, ...body }: AssistantActionDecisionBody & { toolCallId: string }) =>
      requestJson(decideAssistantActionContract, {
        params: { id: organizationId, chatId, toolCallId },
        body,
      }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: assistantActionKeys.review(organizationId, chatId) }),
  })
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
