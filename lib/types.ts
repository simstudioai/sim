/**
 * Execution method types
 */
export type ExecutionMethod = 'manual' | 'scheduled' | 'api' | 'webhook'

/**
 * Execution trigger source
 */
export type ExecutionTrigger = 'manual' | 'scheduled' | 'api' | 'webhook'

/**
 * Webhook configuration
 */
export type WebhookConfig = {
  secretToken?: string
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}

/**
 * Extended workflow metadata to include webhook configuration
 */
export interface WorkflowMetadata {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  isDeployed?: boolean
  apiKey?: string
  executionMethod?: ExecutionMethod
  webhookConfig?: WebhookConfig
}

/**
 * Webhook execution data
 */
export type WebhookData = {
  requestHeaders?: Record<string, string>
  requestBody?: unknown
  signatureValid?: boolean
  ipAddress?: string
}
