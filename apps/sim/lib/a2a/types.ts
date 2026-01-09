/**
 * A2A (Agent-to-Agent) Protocol Types
 *
 * Implements the A2A protocol specification for agent interoperability.
 * @see https://a2a-protocol.org/specification
 */

/**
 * JSON Schema type for input/output definitions
 */
export interface JSONSchema {
  type: string
  properties?: Record<string, JSONSchema | JSONSchemaProperty>
  required?: string[]
  items?: JSONSchema
  description?: string
  enum?: string[]
  default?: unknown
  additionalProperties?: boolean | JSONSchema
}

export interface JSONSchemaProperty {
  type: string
  description?: string
  enum?: string[]
  default?: unknown
  items?: JSONSchema
}

/**
 * Agent Card - Discovery document for A2A agents
 * Describes an agent's capabilities, skills, and how to interact with it
 */
export interface AgentCard {
  /** Human-readable name of the agent */
  name: string
  /** Description of what the agent does */
  description?: string
  /** Base URL for the agent's A2A endpoint */
  url: string
  /** Version of the agent implementation */
  version: string
  /** URL to agent documentation */
  documentationUrl?: string
  /** Provider information */
  provider?: AgentProvider
  /** Agent capabilities */
  capabilities: AgentCapabilities
  /** Skills the agent can perform */
  skills: AgentSkill[]
  /** Authentication configuration */
  authentication?: AgentAuthentication
  /** Default input modes accepted */
  defaultInputModes?: InputMode[]
  /** Default output modes produced */
  defaultOutputModes?: OutputMode[]
}

export interface AgentProvider {
  organization: string
  url?: string
}

export interface AgentCapabilities {
  /** Whether the agent supports streaming responses */
  streaming?: boolean
  /** Whether the agent supports push notifications */
  pushNotifications?: boolean
  /** Whether the agent tracks state transition history */
  stateTransitionHistory?: boolean
}

export interface AgentSkill {
  /** Unique identifier for the skill */
  id: string
  /** Human-readable name */
  name: string
  /** Description of what the skill does */
  description?: string
  /** Tags for categorization */
  tags?: string[]
  /** JSON Schema for input parameters */
  inputSchema?: JSONSchema
  /** JSON Schema for output */
  outputSchema?: JSONSchema
  /** Example interactions */
  examples?: SkillExample[]
}

export interface SkillExample {
  input: TaskMessage
  output: TaskMessage[]
}

export interface AgentAuthentication {
  /** Supported authentication schemes */
  schemes: AuthScheme[]
  /** Credentials hint or reference */
  credentials?: string
}

export type AuthScheme = 'bearer' | 'apiKey' | 'oauth2' | 'none'
export type InputMode = 'text' | 'file' | 'data'
export type OutputMode = 'text' | 'file' | 'data'

/**
 * Task - Core unit of work in A2A protocol (v0.2.6)
 */
export interface Task {
  /** Unique task identifier */
  id: string
  /** Server-generated context ID for contextual alignment across interactions */
  contextId?: string
  /** Current task status */
  status: TaskStatusObject
  /** Message history */
  history?: TaskMessage[]
  /** Structured output artifacts */
  artifacts?: Artifact[]
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /** Event kind - always "task" */
  kind?: 'task'
}

/**
 * Task state lifecycle (v0.2.6)
 */
export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'
  | 'auth-required'
  | 'unknown'

/**
 * Task status object (v0.2.6)
 * Represents the current state and associated context of a Task
 */
export interface TaskStatusObject {
  /** The current lifecycle state of the task */
  state: TaskState
  /** Additional status updates for the client */
  message?: TaskMessage
  /** ISO 8601 datetime string indicating when the status was recorded */
  timestamp?: string
}

/**
 * Legacy TaskStatus type for backward compatibility
 * @deprecated Use TaskState instead
 */
export type TaskStatus = TaskState

/**
 * Task message - A single message in a task conversation
 */
export interface TaskMessage {
  /** Message role */
  role: 'user' | 'agent'
  /** Message content parts */
  parts: MessagePart[]
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Message part types
 */
export type MessagePart = TextPart | FilePart | DataPart

export interface TextPart {
  type: 'text'
  text: string
}

export interface FilePart {
  type: 'file'
  file: FileContent
}

export interface FileContent {
  name?: string
  mimeType?: string
  /** Base64 encoded content */
  bytes?: string
  /** URI reference to file */
  uri?: string
}

export interface DataPart {
  type: 'data'
  data: Record<string, unknown>
}

/**
 * Artifact - Structured output from an agent
 */
export interface Artifact {
  /** Artifact name */
  name?: string
  /** Description of the artifact */
  description?: string
  /** Content parts */
  parts: MessagePart[]
  /** Index for ordering */
  index: number
  /** Whether to append to existing artifact */
  append?: boolean
  /** Whether this is the last chunk (for streaming) */
  lastChunk?: boolean
}

/**
 * JSON-RPC Request Parameters (v0.2.6)
 */
export interface TaskSendParams {
  /** Task ID (optional for new tasks) */
  id?: string
  /** Context ID for contextual alignment across interactions */
  contextId?: string
  /** Message to send */
  message: TaskMessage
  /** Accepted output modes */
  acceptedOutputModes?: OutputMode[]
  /** Push notification configuration */
  pushNotificationConfig?: PushNotificationConfig
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

export interface TaskQueryParams {
  /** Task ID to query */
  id: string
  /** Number of history messages to include */
  historyLength?: number
}

export interface TaskCancelParams {
  /** Task ID to cancel */
  id: string
}

export interface PushNotificationConfig {
  /** Webhook URL for notifications */
  url: string
  /** Authentication token */
  token?: string
  /** Authentication configuration */
  authentication?: {
    schemes: string[]
    credentials?: string
  }
}

/**
 * Task status update event (for streaming)
 */
export interface TaskStatusUpdate {
  /** Task ID */
  id: string
  /** Updated status */
  status: TaskStatusObject
  /** Final result (if completed) */
  final?: boolean
}

/**
 * Task artifact update event (for streaming)
 */
export interface TaskArtifactUpdate {
  /** Task ID */
  id: string
  /** Artifact being updated */
  artifact: Artifact
}

/**
 * A2A Error codes (aligned with JSON-RPC)
 */
export const A2AErrorCode = {
  // Standard JSON-RPC errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // A2A-specific errors
  TASK_NOT_FOUND: -32001,
  TASK_ALREADY_COMPLETE: -32002,
  AGENT_UNAVAILABLE: -32003,
  SKILL_NOT_FOUND: -32004,
  AUTHENTICATION_REQUIRED: -32005,
  RATE_LIMITED: -32006,
} as const

export type A2AErrorCodeType = (typeof A2AErrorCode)[keyof typeof A2AErrorCode]

/**
 * A2A Error class
 */
export class A2AError extends Error {
  constructor(
    message: string,
    public code: A2AErrorCodeType = A2AErrorCode.INTERNAL_ERROR,
    public data?: unknown
  ) {
    super(message)
    this.name = 'A2AError'
  }
}

/**
 * A2A API Response wrapper
 */
export interface A2AApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Database model types
 */
export interface A2AAgentConfig {
  id: string
  workspaceId: string
  workflowId: string
  name: string
  description?: string
  version: string
  capabilities: AgentCapabilities
  skills: AgentSkill[]
  authentication: AgentAuthentication
  isPublished: boolean
  publishedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface A2ATaskRecord {
  id: string
  agentId: string
  contextId?: string
  status: TaskState
  history: TaskMessage[]
  artifacts?: Artifact[]
  executionId?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
}

/**
 * SSE Event types for streaming
 */
export type A2AStreamEvent =
  | { type: 'task:status'; data: TaskStatusUpdate }
  | { type: 'task:artifact'; data: TaskArtifactUpdate }
  | { type: 'task:message'; data: { id: string; message: TaskMessage } }
  | { type: 'task:done'; data: { id: string } }
  | { type: 'error'; data: { code: number; message: string } }
