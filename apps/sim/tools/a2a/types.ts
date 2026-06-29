import type { A2AAgentCardOutput, A2ATaskOutput } from '@/lib/a2a/client'
import type { UserFile } from '@/executor/types'
import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface A2ABaseParams {
  agentUrl: string
  apiKey?: string
}

export interface A2ASendMessageParams extends A2ABaseParams {
  message: string
  data?: unknown
  files?: UserFile[]
  taskId?: string
  contextId?: string
}

export interface A2AGetTaskParams extends A2ABaseParams {
  taskId: string
  historyLength?: number
}

export interface A2ACancelTaskParams extends A2ABaseParams {
  taskId: string
}

export type A2AGetAgentCardParams = A2ABaseParams

export interface A2ATaskResponse extends ToolResponse {
  output: A2ATaskOutput
}

export interface A2ACancelTaskResponse extends ToolResponse {
  output: {
    taskId: string
    state: string
    canceled: boolean
  }
}

export interface A2AAgentCardResponse extends ToolResponse {
  output: A2AAgentCardOutput
}

/** Shared output schema for the task-returning operations (send, get). */
export const A2A_TASK_OUTPUTS = {
  content: { type: 'string', description: 'Agent response text' },
  taskId: { type: 'string', description: 'Task identifier' },
  contextId: { type: 'string', description: 'Conversation/context identifier' },
  state: { type: 'string', description: 'Task lifecycle state' },
  artifacts: {
    type: 'array',
    description: 'Structured task output artifacts',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Artifact name' },
        description: { type: 'string', description: 'Artifact description' },
        content: { type: 'string', description: 'Artifact text content' },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>
