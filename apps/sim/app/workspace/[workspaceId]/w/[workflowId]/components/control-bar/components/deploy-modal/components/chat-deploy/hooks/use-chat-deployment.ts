import { useCallback, useState } from 'react'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import type { ChatFormData } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/hooks/use-chat-form'
import type { OutputConfig } from '@/stores/panel/chat/types'

const logger = createLogger('ChatDeployment')

export interface ChatDeploymentState {
  isLoading: boolean
  error: string | null
  deployedUrl: string | null
}

const chatSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  subdomain: z
    .string()
    .min(1, 'Subdomain is required')
    .regex(/^[a-z0-9-]+$/, 'Subdomain can only contain lowercase letters, numbers, and hyphens'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  customizations: z.object({
    primaryColor: z.string(),
    welcomeMessage: z.string(),
    imageUrl: z.string().optional(),
  }),
  authType: z.enum(['public', 'password', 'email']).default('public'),
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

export function useChatDeployment() {
  const [state, setState] = useState<ChatDeploymentState>({
    isLoading: false,
    error: null,
    deployedUrl: null,
  })

  const deployChat = useCallback(
    async (
      workflowId: string,
      formData: ChatFormData,
      deploymentInfo: { apiKey: string } | null,
      existingChatId?: string,
      imageUrl?: string | null
    ) => {
      setState({ isLoading: true, error: null, deployedUrl: null })

      try {
        // Prepare output configs
        const outputConfigs: OutputConfig[] = formData.selectedOutputBlocks
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
          .filter(Boolean) as OutputConfig[]

        // Create request payload
        const payload = {
          workflowId,
          subdomain: formData.subdomain.trim(),
          title: formData.title.trim(),
          description: formData.description.trim(),
          customizations: {
            primaryColor: 'var(--brand-primary-hover-hex)',
            welcomeMessage: formData.welcomeMessage.trim(),
            ...(imageUrl && { imageUrl }),
          },
          authType: formData.authType,
          password: formData.authType === 'password' ? formData.password : undefined,
          allowedEmails: formData.authType === 'email' ? formData.emails : [],
          outputConfigs,
          apiKey: deploymentInfo?.apiKey,
          deployApiEnabled: !existingChatId, // Only deploy API for new chats
        }

        // Validate with Zod
        chatSchema.parse(payload)

        // Determine endpoint and method
        const endpoint = existingChatId ? `/api/chat/edit/${existingChatId}` : '/api/chat'
        const method = existingChatId ? 'PATCH' : 'POST'

        const response = await fetch(endpoint, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const result = await response.json()

        if (!response.ok) {
          // Handle subdomain conflict specifically
          if (result.error === 'Subdomain already in use') {
            throw new Error('This subdomain is already in use')
          }
          throw new Error(result.error || `Failed to ${existingChatId ? 'update' : 'deploy'} chat`)
        }

        if (!result.chatUrl) {
          throw new Error('Response missing chatUrl')
        }

        setState({
          isLoading: false,
          error: null,
          deployedUrl: result.chatUrl,
        })

        logger.info(`Chat ${existingChatId ? 'updated' : 'deployed'} successfully:`, result.chatUrl)
        return result.chatUrl
      } catch (error: any) {
        const errorMessage = error.message || 'An unexpected error occurred'
        setState({
          isLoading: false,
          error: errorMessage,
          deployedUrl: null,
        })

        logger.error(`Failed to ${existingChatId ? 'update' : 'deploy'} chat:`, error)
        throw error
      }
    },
    []
  )

  const reset = useCallback(() => {
    setState({
      isLoading: false,
      error: null,
      deployedUrl: null,
    })
  }, [])

  return {
    ...state,
    deployChat,
    reset,
  }
}
