import type { Artifact, Message, TaskState } from '@a2a-js/sdk'
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property constants for A2A tools based on the official A2A protocol specification.
 * @see https://a2a-protocol.org/latest/specification/
 */

/** Part content types (TextPart, FilePart, DataPart) - union type */
const PART_PROPERTIES = {
  text: { type: 'string', description: 'Plain text content (TextPart)', optional: true },
  fileUri: { type: 'string', description: 'Resolvable file location (FilePart)', optional: true },
  mediaType: { type: 'string', description: 'MIME type specification (FilePart)', optional: true },
  data: { type: 'object', description: 'Structured content (DataPart)', optional: true },
  schema: {
    type: 'object',
    description: 'JSON Schema defining structure (DataPart)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Message output properties per A2A spec */
const MESSAGE_PROPERTIES = {
  id: { type: 'string', description: 'Message identifier', optional: true },
  role: { type: 'string', description: 'Message originator (user or agent)' },
  parts: {
    type: 'array',
    description: 'Content segments',
    items: { type: 'object', properties: PART_PROPERTIES },
  },
  timestamp: { type: 'string', description: 'ISO 8601 creation time' },
  referenceTaskIds: {
    type: 'array',
    description: 'Related task references',
    items: { type: 'string' },
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Artifact output properties per A2A spec */
const ARTIFACT_PROPERTIES = {
  id: { type: 'string', description: 'Artifact identifier' },
  title: { type: 'string', description: 'Human-readable title', optional: true },
  parts: {
    type: 'array',
    description: 'Composed content pieces',
    items: { type: 'object', properties: PART_PROPERTIES },
  },
  mediaType: { type: 'string', description: 'Primary media type descriptor', optional: true },
} as const satisfies Record<string, OutputProperty>

/** TaskStatus output properties per A2A spec */
const TASK_STATUS_PROPERTIES = {
  state: {
    type: 'string',
    description:
      'Current lifecycle state (working, completed, failed, canceled, rejected, input_required, auth_required)',
  },
  timestamp: { type: 'string', description: 'ISO 8601 formatted status update time' },
  progress: { type: 'number', description: 'Percentage completion (0-100)', optional: true },
  message: { type: 'string', description: 'Human-readable status description', optional: true },
} as const satisfies Record<string, OutputProperty>

/** AgentProvider output properties per A2A spec */
const AGENT_PROVIDER_PROPERTIES = {
  name: { type: 'string', description: 'Organization name' },
  url: { type: 'string', description: 'Organization website', optional: true },
  logo: { type: 'string', description: 'Brand image URI', optional: true },
} as const satisfies Record<string, OutputProperty>

/** AgentCapabilities output properties per A2A spec */
const AGENT_CAPABILITIES_PROPERTIES = {
  streaming: { type: 'boolean', description: 'Supports real-time streaming', optional: true },
  pushNotifications: { type: 'boolean', description: 'Supports webhook callbacks', optional: true },
  extendedAgentCard: {
    type: 'boolean',
    description: 'Provides authenticated extended card',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/** AgentSkill output properties per A2A spec */
const AGENT_SKILL_PROPERTIES = {
  id: { type: 'string', description: 'Skill identifier' },
  name: { type: 'string', description: 'Human-readable name' },
  description: { type: 'string', description: 'Functionality description', optional: true },
  inputSchema: { type: 'object', description: 'JSON Schema for inputs', optional: true },
  outputSchema: { type: 'object', description: 'JSON Schema for outputs', optional: true },
  supportedMediaTypes: {
    type: 'array',
    description: 'Accepted content types',
    items: { type: 'string' },
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Shared output properties for A2A tools.
 * These constants can be spread into tool output definitions to ensure consistency.
 */
export const A2A_OUTPUT_PROPERTIES = {
  /** Task ID output */
  taskId: { type: 'string', description: 'Unique task identifier' },

  /** Context ID output */
  contextId: { type: 'string', description: 'Groups related tasks/messages', optional: true },

  /** Task state output (simplified string version) */
  state: {
    type: 'string',
    description:
      'Current lifecycle state (working, completed, failed, canceled, rejected, input_required, auth_required)',
  },

  /** Task status output (full object) */
  status: {
    type: 'object',
    description: 'Current task status',
    properties: TASK_STATUS_PROPERTIES,
  },

  /** Artifacts output array */
  artifacts: {
    type: 'array',
    description: 'Task output artifacts',
    items: { type: 'object', properties: ARTIFACT_PROPERTIES },
    optional: true,
  },

  /** Message history output array */
  history: {
    type: 'array',
    description: 'Conversation history (Message array)',
    items: { type: 'object', properties: MESSAGE_PROPERTIES },
    optional: true,
  },

  /** Agent card name */
  agentName: { type: 'string', description: 'Agent display name' },

  /** Agent card description */
  agentDescription: {
    type: 'string',
    description: 'Agent purpose/capabilities',
    optional: true,
  },

  /** Agent endpoint URL */
  agentEndpoint: { type: 'string', description: 'Service endpoint URL' },

  /** Agent provider */
  agentProvider: {
    type: 'object',
    description: 'Creator organization details',
    properties: AGENT_PROVIDER_PROPERTIES,
    optional: true,
  },

  /** Agent capabilities */
  agentCapabilities: {
    type: 'object',
    description: 'Feature support matrix',
    properties: AGENT_CAPABILITIES_PROPERTIES,
  },

  /** Agent skills array */
  agentSkills: {
    type: 'array',
    description: 'Available operations',
    items: { type: 'object', properties: AGENT_SKILL_PROPERTIES },
    optional: true,
  },

  /** Protocol version (single string from protocolVersion field) */
  version: { type: 'string', description: 'A2A protocol version supported by the agent' },

  /** Default input modes */
  defaultInputModes: {
    type: 'array',
    description: 'Default input content types accepted by the agent',
    items: { type: 'string' },
    optional: true,
  },

  /** Default output modes */
  defaultOutputModes: {
    type: 'array',
    description: 'Default output content types produced by the agent',
    items: { type: 'string' },
    optional: true,
  },

  /** Push notification webhook URL */
  webhookUrl: { type: 'string', description: 'HTTPS webhook URL for notifications' },

  /** Push notification authentication token */
  webhookToken: {
    type: 'string',
    description: 'Authentication token for webhook validation',
    optional: true,
  },

  /** Success boolean */
  success: { type: 'boolean', description: 'Whether the operation was successful' },

  /** Cancelled boolean */
  cancelled: { type: 'boolean', description: 'Whether cancellation was successful' },

  /** Exists boolean */
  exists: { type: 'boolean', description: 'Whether the resource exists' },

  /** Is running boolean */
  isRunning: { type: 'boolean', description: 'Whether the task is still running' },

  /** Content/text response */
  content: { type: 'string', description: 'Text response content from the agent' },
} as const satisfies Record<string, OutputProperty>

export interface A2AGetAgentCardParams {
  agentUrl: string
  apiKey?: string
}

export interface A2AGetAgentCardResponse extends ToolResponse {
  output: {
    name: string
    description?: string
    url: string
    version: string
    capabilities?: {
      streaming?: boolean
      pushNotifications?: boolean
      stateTransitionHistory?: boolean
    }
    skills?: Array<{
      id: string
      name: string
      description?: string
    }>
    defaultInputModes?: string[]
    defaultOutputModes?: string[]
  }
}

export interface A2ASendMessageFileInput {
  type: 'file' | 'url'
  data: string
  name: string
  mime?: string
}

export interface A2ASendMessageParams {
  agentUrl: string
  message: string
  taskId?: string
  contextId?: string
  data?: string
  files?: A2ASendMessageFileInput[]
  apiKey?: string
}

export interface A2ASendMessageResponse extends ToolResponse {
  output: {
    content: string
    taskId: string
    contextId?: string
    state: TaskState
    artifacts?: Artifact[]
    history?: Message[]
  }
}

export interface A2AGetTaskParams {
  agentUrl: string
  taskId: string
  apiKey?: string
  historyLength?: number
}

export interface A2AGetTaskResponse extends ToolResponse {
  output: {
    taskId: string
    contextId?: string
    state: TaskState
    artifacts?: Artifact[]
    history?: Message[]
  }
}

export interface A2ACancelTaskParams {
  agentUrl: string
  taskId: string
  apiKey?: string
}

export interface A2ACancelTaskResponse extends ToolResponse {
  output: {
    cancelled: boolean
    state: TaskState
  }
}

export interface A2AResubscribeParams {
  agentUrl: string
  taskId: string
  apiKey?: string
}

export interface A2AResubscribeResponse extends ToolResponse {
  output: {
    taskId: string
    contextId?: string
    state: TaskState
    isRunning: boolean
    artifacts?: Artifact[]
    history?: Message[]
  }
}

export interface A2ASetPushNotificationParams {
  agentUrl: string
  taskId: string
  webhookUrl: string
  token?: string
  apiKey?: string
}

export interface A2ASetPushNotificationResponse extends ToolResponse {
  output: {
    url: string
    token?: string
    success: boolean
  }
}

export interface A2AGetPushNotificationParams {
  agentUrl: string
  taskId: string
  apiKey?: string
}

export interface A2AGetPushNotificationResponse extends ToolResponse {
  output: {
    url?: string
    token?: string
    exists: boolean
  }
}

export interface A2ADeletePushNotificationParams {
  agentUrl: string
  taskId: string
  pushNotificationConfigId?: string
  apiKey?: string
}

export interface A2ADeletePushNotificationResponse extends ToolResponse {
  output: {
    success: boolean
  }
}
