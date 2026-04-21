import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
export type AuthType = 'public' | 'password' | 'email' | 'sso'

/**
 * Deployed chat configuration returned from the public chat endpoint
 */
export interface DeployedChatConfig {
  id: string
  title: string
  description: string
  customizations: {
    primaryColor?: string
    logoUrl?: string
    imageUrl?: string
    welcomeMessage?: string
    headerText?: string
  }
  authType?: AuthType
  outputConfigs?: Array<{ blockId: string; path?: string }>
}

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
  const response = await fetch(`/api/chat/${identifier}`, {
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    signal,
  })

  if (response.status === 401) {
    const errorData = await response.json().catch(() => ({}))
    const authType = AUTH_ERROR_MAP[errorData?.error]
    if (authType) {
      return { kind: 'auth', authType }
    }
    throw new Error('Unauthorized')
  }

  if (!response.ok) {
    throw new Error(`Failed to load chat configuration: ${response.status}`)
  }

  const config = (await response.json()) as DeployedChatConfig
  return { kind: 'config', config }
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
  body: Record<string, unknown>
): Promise<DeployedChatConfig> {
  const response = await fetch(`/api/chat/${identifier}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData?.error || 'Authentication failed')
  }

  return (await response.json()) as DeployedChatConfig
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
      const response = await fetch(`/api/chat/${identifier}/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData?.error || 'Failed to send verification code')
      }
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
      const response = await fetch(`/api/chat/${identifier}/otp`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email, otp }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData?.error || 'Invalid verification code')
      }
      return (await response.json()) as DeployedChatConfig
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
  apiKey?: string
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
 * Response from chat create/update mutations
 */
interface ChatMutationResult {
  chatUrl: string
  chatId?: string
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
  apiKey?: string,
  imageUrl?: string | null,
  isUpdate?: boolean
) {
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
    apiKey,
    deployApiEnabled: !isUpdate,
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
      apiKey,
      imageUrl,
    }: CreateChatVariables): Promise<ChatMutationResult> => {
      const payload = buildChatPayload(workflowId, formData, apiKey, imageUrl, false)

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await response.json()

      if (!response.ok) {
        if (result.error === 'Identifier already in use') {
          throw new Error('This identifier is already in use')
        }
        throw new Error(result.error || 'Failed to deploy chat')
      }

      if (!result.chatUrl) {
        throw new Error('Response missing chatUrl')
      }

      logger.info('Chat deployed successfully:', result.chatUrl)
      return { chatUrl: result.chatUrl, chatId: result.chatId }
    },
    onSuccess: (_, variables) => {
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
    }: UpdateChatVariables): Promise<ChatMutationResult> => {
      const payload = buildChatPayload(workflowId, formData, undefined, imageUrl, true)

      const response = await fetch(`/api/chat/manage/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await response.json()

      if (!response.ok) {
        if (result.error === 'Identifier already in use') {
          throw new Error('This identifier is already in use')
        }
        throw new Error(result.error || 'Failed to update chat')
      }

      if (!result.chatUrl) {
        throw new Error('Response missing chatUrl')
      }

      logger.info('Chat updated successfully:', result.chatUrl)
      return { chatUrl: result.chatUrl, chatId }
    },
    onSuccess: (_, variables) => {
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
      const response = await fetch(`/api/chat/manage/${chatId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete chat')
      }

      logger.info('Chat deleted successfully')
    },
    onSuccess: (_, variables) => {
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
