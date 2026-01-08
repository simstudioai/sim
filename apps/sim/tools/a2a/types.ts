/**
 * A2A Tool Types (v0.2.6)
 */

import type {
  AgentAuthentication,
  AgentCapabilities,
  AgentSkill,
  Artifact,
  InputMode,
  OutputMode,
  TaskMessage,
  TaskState,
} from '@/lib/a2a/types'
import type { ToolResponse } from '@/tools/types'

export interface A2AGetAgentCardParams {
  /** A2A agent endpoint URL */
  agentUrl: string
  /** API key for authentication (if required) */
  apiKey?: string
}

export interface A2AGetAgentCardResponse extends ToolResponse {
  output: {
    /** Agent name */
    name: string
    /** Agent description */
    description?: string
    /** Agent endpoint URL */
    url: string
    /** Agent version */
    version: string
    /** Agent capabilities */
    capabilities?: AgentCapabilities
    /** Skills the agent can perform */
    skills?: AgentSkill[]
    /** Supported authentication schemes */
    authentication?: AgentAuthentication
    /** Default input modes */
    defaultInputModes?: InputMode[]
    /** Default output modes */
    defaultOutputModes?: OutputMode[]
  }
}

export interface A2ASendTaskParams {
  /** A2A agent endpoint URL */
  agentUrl: string
  /** Message to send */
  message: string
  /** Task ID (for continuing a task) */
  taskId?: string
  /** Context ID (for multi-turn conversations) */
  contextId?: string
  /** API key for authentication */
  apiKey?: string
}

export interface A2ASendTaskResponse extends ToolResponse {
  output: {
    /** Response content text */
    content: string
    /** Task ID */
    taskId: string
    /** Context ID */
    contextId?: string
    /** Task state */
    state: TaskState
    /** Output artifacts */
    artifacts?: Artifact[]
    /** Message history */
    history?: TaskMessage[]
  }
}

export interface A2AGetTaskParams {
  /** A2A agent endpoint URL */
  agentUrl: string
  /** Task ID to query */
  taskId: string
  /** API key for authentication */
  apiKey?: string
  /** Number of history messages to include */
  historyLength?: number
}

export interface A2AGetTaskResponse extends ToolResponse {
  output: {
    /** Task ID */
    taskId: string
    /** Context ID */
    contextId?: string
    /** Task state */
    state: TaskState
    /** Output artifacts */
    artifacts?: Artifact[]
    /** Message history */
    history?: TaskMessage[]
  }
}

export interface A2ACancelTaskParams {
  /** A2A agent endpoint URL */
  agentUrl: string
  /** Task ID to cancel */
  taskId: string
  /** API key for authentication */
  apiKey?: string
}

export interface A2ACancelTaskResponse extends ToolResponse {
  output: {
    /** Whether cancellation was successful */
    cancelled: boolean
    /** Task state after cancellation */
    state: TaskState
  }
}
