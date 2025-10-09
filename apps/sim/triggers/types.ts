export type TriggerFieldType = 'string' | 'boolean' | 'select' | 'number' | 'multiselect' | 'credential'

export interface TriggerConfigField {
  type: TriggerFieldType
  label: string
  placeholder?: string
  options?: string[]
  defaultValue?: string | boolean | number | string[]
  description?: string
  required?: boolean
  isSecret?: boolean
  provider?: string // OAuth provider for credential type fields
  requiredScopes?: string[] // Required OAuth scopes for credential type fields
}

export interface TriggerOutput {
  type?: string
  description?: string
  [key: string]: TriggerOutput | string | undefined
}

export interface TriggerConfig {
  id: string
  name: string
  provider: string
  description: string
  version: string

  // Optional icon component for UI display
  icon?: React.ComponentType<{ className?: string }>

  // Configuration fields that users need to fill
  configFields: Record<string, TriggerConfigField>

  // Define the structure of data this trigger outputs to workflows
  outputs: Record<string, TriggerOutput>

  // Setup instructions for users
  instructions: string[]

  // Example payload for documentation
  samplePayload: any

  // Webhook configuration (for most triggers)
  webhook?: {
    method?: 'POST' | 'GET' | 'PUT' | 'DELETE'
    headers?: Record<string, string>
  }

  // For triggers that require OAuth credentials (like Gmail)
  requiresCredentials?: boolean
  credentialProvider?: string // 'google-email', 'microsoft', etc.
}

export interface TriggerRegistry {
  [triggerId: string]: TriggerConfig
}

export interface TriggerInstance {
  id: string
  triggerId: string
  blockId: string
  workflowId: string
  config: Record<string, any>
  webhookPath?: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}
