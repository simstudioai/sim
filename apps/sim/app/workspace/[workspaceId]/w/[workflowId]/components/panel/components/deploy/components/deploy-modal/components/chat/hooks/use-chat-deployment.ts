import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { OutputConfig } from '@/stores/chat/types'

const logger = createLogger('ChatDeployment')

export type AuthType = 'public' | 'password' | 'email' | 'sso'

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

const chatSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  identifier: z
    .string()
    .min(1, 'Identifier is required')
    .regex(/^[a-z0-9-]+$/, 'Identifier can only contain lowercase letters, numbers, and hyphens'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  customizations: z.object({
    primaryColor: z.string(),
    welcomeMessage: z.string(),
    imageUrl: z.string().optional(),
  }),
  authType: z.enum(['public', 'password', 'email', 'sso']).default('public'),
  password: z.string().optional(),
  allowedEmails: z.array(z.string()).optional().default([]),
  outputConfigs: z
    .array(
      z.object({
        blockId: z.string(),
        path: z.string(),
      })
    )
    .optional()
    .default([]),
})

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
 * Hook for deploying or updating a chat interface
 */
export function useChatDeployment() {
  const deployChat = useCallback(
    async (
      workflowId: string,
      formData: ChatFormData,
      deploymentInfo: { apiKey: string } | null,
      existingChatId?: string,
      imageUrl?: string | null
    ): Promise<string> => {
      const outputConfigs = parseOutputConfigs(formData.selectedOutputBlocks)

      const payload = {
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
        apiKey: deploymentInfo?.apiKey,
        deployApiEnabled: !existingChatId,
      }

      chatSchema.parse(payload)

      const endpoint = existingChatId ? `/api/chat/manage/${existingChatId}` : '/api/chat'
      const method = existingChatId ? 'PATCH' : 'POST'

      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await response.json()

      if (!response.ok) {
        if (result.error === 'Identifier already in use') {
          throw new Error('This identifier is already in use')
        }
        throw new Error(result.error || `Failed to ${existingChatId ? 'update' : 'deploy'} chat`)
      }

      if (!result.chatUrl) {
        throw new Error('Response missing chatUrl')
      }

      logger.info(`Chat ${existingChatId ? 'updated' : 'deployed'} successfully:`, result.chatUrl)
      return result.chatUrl
    },
    []
  )

  return { deployChat }
}
