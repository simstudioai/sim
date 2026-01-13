/**
 * A2A (Agent-to-Agent) Protocol Types (v0.3)
 * @see https://a2a-protocol.org/specification
 */

export {
  AGENT_CARD_PATH,
  type AgentCapabilities,
  type AgentCard,
  type AgentProvider,
  type AgentSkill,
  type Artifact,
  type DataPart,
  type FilePart,
  type Message,
  type MessageSendConfiguration,
  type MessageSendParams,
  type Part,
  type PushNotificationConfig,
  type Task,
  type TaskArtifactUpdateEvent,
  type TaskIdParams,
  type TaskPushNotificationConfig,
  type TaskQueryParams,
  type TaskState,
  type TaskStatus,
  type TaskStatusUpdateEvent,
  type TextPart,
} from '@a2a-js/sdk'
export {
  type A2AClientOptions,
  type AuthenticationHandler,
  Client,
  type ClientConfig,
  ClientFactory,
  type RequestOptions,
} from '@a2a-js/sdk/client'
export {
  A2AError,
  type AgentExecutor,
  DefaultExecutionEventBus,
  DefaultRequestHandler,
  type ExecutionEventBus,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  type RequestContext,
  type TaskStore,
} from '@a2a-js/sdk/server'

/**
 * App-specific: Extended MessageSendParams
 * Note: Structured inputs should be passed via DataPart in message.parts (A2A spec compliant)
 * Files should be passed via FilePart in message.parts
 */
export interface ExtendedMessageSendParams {
  message: import('@a2a-js/sdk').Message
  configuration?: import('@a2a-js/sdk').MessageSendConfiguration
}

/**
 * App-specific: Database model for A2A Agent configuration
 */
export interface A2AAgentConfig {
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
export interface AgentCardSignature {
  algorithm: string
  keyId: string
  value: string
}

/**
 * App-specific: Database model for A2A Task record
 */
export interface A2ATaskRecord {
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
export interface A2AApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * App-specific: JSON Schema definition for skill input/output schemas
 */
export interface JSONSchema {
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
