/**
 * A2A (Agent-to-Agent) Protocol Types (v0.3)
 * @see https://a2a-protocol.org/specification
 */

export type {
  AgentCapabilities,
  AgentSkill,
} from '@a2a-js/sdk'

/**
 * App-specific: Extended MessageSendParams
 * Note: Structured inputs should be passed via DataPart in message.parts (A2A spec compliant)
 * Files should be passed via FilePart in message.parts
 */
interface ExtendedMessageSendParams {
  message: import('@a2a-js/sdk').Message
  configuration?: import('@a2a-js/sdk').MessageSendConfiguration
}

/**
 * App-specific: Database model for A2A Agent configuration
 */
interface A2AAgentConfig {
  id: string
  workspaceId: string
  workflowId: string
  name: string
  description?: string
  version: string
  capabilities: import('@a2a-js/sdk').AgentCapabilities
  skills: import('@a2a-js/sdk').AgentSkill[]
  authentication?: AgentAuthentication
  signatures?: AgentCardSignature[]
  isPublished: boolean
  publishedAt?: Date
  createdAt: Date
  updatedAt: Date
}

/**
 * App-specific: Agent authentication configuration
 */
export interface AgentAuthentication {
  schemes: Array<'bearer' | 'apiKey' | 'oauth2' | 'none'>
  credentials?: string
}

/**
 * App-specific: Agent card signature (v0.3)
 */
interface AgentCardSignature {
  algorithm: string
  keyId: string
  value: string
}

/**
 * App-specific: Database model for A2A Task record
 */
interface A2ATaskRecord {
  id: string
  agentId: string
  contextId?: string
  status: import('@a2a-js/sdk').TaskState
  history: import('@a2a-js/sdk').Message[]
  artifacts?: import('@a2a-js/sdk').Artifact[]
  executionId?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
}

/**
 * App-specific: A2A API Response wrapper
 */
interface A2AApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * App-specific: JSON Schema definition for skill input/output schemas
 */
interface JSONSchema {
  type?: string
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: string[]
  description?: string
  enum?: unknown[]
  default?: unknown
  format?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  additionalProperties?: boolean | JSONSchema
  [key: string]: unknown
}
