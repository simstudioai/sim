import type { Artifact, Message, TaskState } from '@a2a-js/sdk'
import type { ToolResponse } from '@/tools/types'

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
