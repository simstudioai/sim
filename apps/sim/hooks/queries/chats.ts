import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  authenticateDeployedChatContract,
  type ChatAuthType,
  type CreateChatBody,
  type CreateChatResponse,
  createChatContract,
  type DeployedChatAuthBody,
  type DeployedChatConfig,
  deleteChatContract,
  getDeployedChatConfigContract,
  requestChatEmailOtpContract,
  type UpdateChatBody,
  type UpdateChatResponse,
  updateChatContract,
  verifyChatEmailOtpContract,
} from '@/lib/api/contracts/chats'
import type { OutputConfig } from '@/stores/chat/types'
import { deploymentKeys } from './deployments'

const logger = createLogger('ChatMutations')

/**
 * Query keys for chat-related queries
 */
export const chatKeys = {
  all: ['chats'] as const,
  status: deploymentKeys.chatStatus,
  detail: deploymentKeys.chatDetail,
  configs: () => [...chatKeys.all, 'config'] as const,
  config: (identifier?: string) => [...chatKeys.configs(), identifier ?? ''] as const,
}

/**
 * Auth types for chat access control
 */
export type AuthType = ChatAuthType

/** Deployed chat configuration returned from the public chat endpoint. */
export type { DeployedChatConfig }

/**
 * Result of loading a deployed chat's configuration.
 * When the endpoint responds 401 with an auth_required_* error, the query
 * succeeds with `kind: 'auth'` so consumers can render the auth form without
 * treating it as a fetch error.
 */
export type DeployedChatConfigResult =
  | { kind: 'config'; config: DeployedChatConfig }
  | { kind: 'auth'; authType: 'password' | 'email' | 'sso' }

const AUTH_ERROR_MAP: Record<string, 'password' | 'email' | 'sso'> = {
  auth_required_password: 'password',
  auth_required_email: 'email',
  auth_required_sso: 'sso',
}

async function fetchDeployedChatConfig(
  identifier: string,
  signal?: AbortSignal
): Promise<DeployedChatConfigResult> {
  try {
    const config = await requestJson(getDeployedChatConfigContract, {
      params: { identifier },
      signal,
    })
    return { kind: 'config', config }
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      const authType = AUTH_ERROR_MAP[error.message]
      if (authType) {
        return { kind: 'auth', authType }
      }
      throw new Error('Unauthorized', { cause: error })
    }

    throw error
  }
}

/**
 * Loads the public chat configuration for a deployed chat identifier.
 * Resolves to `{ kind: 'auth', authType }` when the chat requires
 * password/email/SSO gating so the consumer can render the appropriate form.
 */
export function useDeployedChatConfig(identifier: string) {
  return useQuery({
    queryKey: chatKeys.config(identifier),
    queryFn: ({ signal }) => fetchDeployedChatConfig(identifier, signal),
    enabled: Boolean(identifier),
    staleTime: 60 * 1000,
    retry: false,
  })
}

async function postChatAuth(
  identifier: string,
  body: DeployedChatAuthBody
): Promise<DeployedChatConfig> {
  return requestJson(authenticateDeployedChatContract, {
    params: { identifier },
    body,
  })
}

/**
 * Authenticates against a password-gated deployed chat. On success, seeds the
 * config query cache with the returned chat config so the consumer can render
 * the chat immediately without a follow-up GET.
 */
export function useChatPasswordAuth(identifier: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ password }: { password: string }) => postChatAuth(identifier, { password }),
    onSuccess: (config) => {
      queryClient.setQueryData<DeployedChatConfigResult>(chatKeys.config(identifier), {
        kind: 'config',
        config,
      })
    },
  })
}

/**
 * Requests a one-time passcode for an email-gated deployed chat.
 * Used for both the initial send and resend flows.
 */
export function useChatEmailOtpRequest(identifier: string) {
  return useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      await requestJson(requestChatEmailOtpContract, {
        params: { identifier },
        body: { email },
      })
    },
  })
}

/**
 * Verifies a one-time passcode for an email-gated deployed chat. On success,
 * seeds the config query cache with the returned chat config.
 */
export function useChatEmailOtpVerify(identifier: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ email, otp }: { email: string; otp: string }) => {
      return requestJson(verifyChatEmailOtpContract, {
        params: { identifier },
        body: { email, otp },
      })
    },
    onSuccess: (config) => {
      queryClient.setQueryData<DeployedChatConfigResult>(chatKeys.config(identifier), {
        kind: 'config',
        config,
      })
    },
  })
}

/**
 * Form data for creating/updating a chat
 */
export interface ChatFormData {
  identifier: string
  title: string
  description: string
  authType: AuthType
  password: string
  emails: string[]
  welcomeMessage: string
  selectedOutputBlocks: string[]
}

/**
 * Variables for create chat mutation
 */
interface CreateChatVariables {
  workflowId: string
  formData: ChatFormData
  imageUrl?: string | null
}

/**
 * Variables for update chat mutation
 */
interface UpdateChatVariables {
  chatId: string
  workflowId: string
  formData: ChatFormData
  imageUrl?: string | null
}

/**
 * Variables for delete chat mutation
 */
interface DeleteChatVariables {
  chatId: string
  workflowId: string
}

/**
 * Data returned by chat create/update mutations
 */
type ChatMutationData =
  | Pick<CreateChatResponse, 'chatUrl' | 'chatId'>
  | Pick<UpdateChatResponse, 'chatUrl'>

function throwUserFriendlyIdentifierError(error: unknown): never {
  if (error instanceof ApiClientError && error.message === 'Identifier already in use') {
    throw new Error('This identifier is already in use', { cause: error })
  }

  throw error
}

/**
 * Parses output block selections into structured output configs
 */
function parseOutputConfigs(selectedOutputBlocks: string[]): OutputConfig[] {
  return selectedOutputBlocks
    .map((outputId) => {
      const firstUnderscoreIndex = outputId.indexOf('_')
      if (firstUnderscoreIndex !== -1) {
        const blockId = outputId.substring(0, firstUnderscoreIndex)
        const path = outputId.substring(firstUnderscoreIndex + 1)
        if (blockId && path) {
          return { blockId, path }
        }
      }
      return null
    })
    .filter((config): config is OutputConfig => config !== null)
}

/**
 * Build chat payload from form data
 */
function buildChatPayload(
  workflowId: string,
  formData: ChatFormData,
  imageUrl?: string | null
): CreateChatBody {
  const outputConfigs = parseOutputConfigs(formData.selectedOutputBlocks)

  return {
    workflowId,
    identifier: formData.identifier.trim(),
    title: formData.title.trim(),
    description: formData.description.trim(),
    customizations: {
      primaryColor: 'var(--brand-hover)',
      welcomeMessage: formData.welcomeMessage.trim(),
      ...(imageUrl && { imageUrl }),
    },
    authType: formData.authType,
    password: formData.authType === 'password' ? formData.password : undefined,
    allowedEmails:
      formData.authType === 'email' || formData.authType === 'sso' ? formData.emails : [],
    outputConfigs,
  }
}

/**
 * Mutation hook for creating a new chat deployment.
 * Invalidates chat status and detail queries on success.
 */
export function useCreateChat() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workflowId,
      formData,
      imageUrl,
    }: CreateChatVariables): Promise<ChatMutationData> => {
      const payload = buildChatPayload(workflowId, formData, imageUrl)

      try {
        const result = await requestJson(createChatContract, { body: payload })
        logger.info('Chat deployed successfully:', result.chatUrl)
        return { chatUrl: result.chatUrl, chatId: result.chatId }
      } catch (error) {
        throwUserFriendlyIdentifierError(error)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.chatStatus(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.info(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.versions(variables.workflowId),
      })
    },
    onError: (error) => {
      logger.error('Failed to create chat', { error })
    },
  })
}

/**
 * Mutation hook for updating an existing chat deployment.
 * Invalidates chat status and detail queries on success.
 */
export function useUpdateChat() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      chatId,
      workflowId,
      formData,
      imageUrl,
    }: UpdateChatVariables): Promise<ChatMutationData> => {
      const payload = buildChatPayload(workflowId, formData, imageUrl)

      try {
        const result = await requestJson(updateChatContract, {
          params: { id: chatId },
          body: payload satisfies UpdateChatBody,
        })
        logger.info('Chat updated successfully:', result.chatUrl)
        return { chatUrl: result.chatUrl, chatId }
      } catch (error) {
        throwUserFriendlyIdentifierError(error)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.chatStatus(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.chatDetail(variables.chatId),
      })
    },
    onError: (error) => {
      logger.error('Failed to update chat', { error })
    },
  })
}

/**
 * Mutation hook for deleting a chat deployment.
 * Invalidates chat status and removes chat detail from cache on success.
 */
export function useDeleteChat() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ chatId }: DeleteChatVariables): Promise<void> => {
      await requestJson(deleteChatContract, { params: { id: chatId } })
      logger.info('Chat deleted successfully')
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.chatStatus(variables.workflowId),
      })
      queryClient.removeQueries({
        queryKey: deploymentKeys.chatDetail(variables.chatId),
      })
    },
    onError: (error) => {
      logger.error('Failed to delete chat', { error })
    },
  })
}
