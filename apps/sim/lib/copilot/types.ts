import type { ProviderId } from '@/providers/types'
import type { CopilotToolCall, ToolState } from '@/stores/panel'

export type NotificationStatus =
  | 'pending'
  | 'success'
  | 'error'
  | 'accepted'
  | 'rejected'
  | 'background'

export type { CopilotToolCall, ToolState }

// Provider configuration for Sim Agent requests.
// This type is only for the `provider` field in requests sent to the Sim Agent.
export type CopilotProviderConfig =
  | {
      provider: 'azure-openai'
      model: string
      apiKey?: string
      apiVersion?: string
      endpoint?: string
    }
  | {
      provider: 'azure-anthropic'
      model: string
      apiKey?: string
      apiVersion?: string
      endpoint?: string
    }
  | {
      provider: 'vertex'
      model: string
      apiKey?: string
      vertexProject?: string
      vertexLocation?: string
    }
  | {
      provider: Exclude<ProviderId, 'azure-openai' | 'azure-anthropic' | 'vertex'>
      model?: string
      apiKey?: string
    }
