import { createLogger } from '@sim/logger'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
}

/**
 * Auth types for chat access control
 */
export type AuthType = 'public' | 'password' | 'email' | 'sso'

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
      primaryColor: 'var(--brand-primary-hover-hex)',
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
