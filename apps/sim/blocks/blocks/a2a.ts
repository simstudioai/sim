import { A2AIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { ToolResponse } from '@/tools/types'

export interface A2AResponse extends ToolResponse {
  output: {
    /** Response content from the agent */
    content?: string
    /** Task ID */
    taskId?: string
    /** Context ID for conversation continuity */
    contextId?: string
    /** Task state */
    state?: string
    /** Structured output artifacts */
    artifacts?: Array<{
      name?: string
      description?: string
      parts: Array<{ kind: string; text?: string; data?: unknown }>
    }>
    /** Full message history */
    history?: Array<{
      role: 'user' | 'agent'
      parts: Array<{ kind: string; text?: string }>
    }>
    /** Whether cancellation was successful (cancel_task) */
    cancelled?: boolean
    /** Whether task is still running (resubscribe) */
    isRunning?: boolean
    /** Agent name (get_agent_card) */
    name?: string
    /** Agent description (get_agent_card) */
    description?: string
    /** Agent URL (get_agent_card) */
    url?: string
    /** Agent version (get_agent_card) */
    version?: string
    /** Agent capabilities (get_agent_card) */
    capabilities?: Record<string, boolean>
    /** Agent skills (get_agent_card) */
    skills?: Array<{ id: string; name: string; description?: string }>
    /** Agent authentication schemes (get_agent_card) */
    authentication?: { schemes: string[] }
    /** Push notification webhook URL */
    webhookUrl?: string
    /** Push notification token */
    token?: string
    /** Whether push notification config exists */
    exists?: boolean
    /** Operation success indicator */
    success?: boolean
  }
}

export const A2ABlock: BlockConfig<A2AResponse> = {
  type: 'a2a',
  name: 'A2A',
  description: 'Interact with external A2A-compatible agents',
  longDescription:
    'Use the A2A (Agent-to-Agent) protocol to interact with external AI agents. ' +
    'Send messages, query task status, cancel tasks, or discover agent capabilities. ' +
    'Compatible with any A2A-compliant agent including LangGraph, Google ADK, and other Sim workflows.',
  docsLink: 'https://docs.sim.ai/blocks/a2a',
  category: 'tools',
  bgColor: '#4151B5',
  icon: A2AIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Message', id: 'a2a_send_message' },
        { label: 'Get Task', id: 'a2a_get_task' },
        { label: 'Cancel Task', id: 'a2a_cancel_task' },
        { label: 'Get Agent Card', id: 'a2a_get_agent_card' },
        { label: 'Resubscribe', id: 'a2a_resubscribe' },
        { label: 'Set Push Notification', id: 'a2a_set_push_notification' },
        { label: 'Get Push Notification', id: 'a2a_get_push_notification' },
        { label: 'Delete Push Notification', id: 'a2a_delete_push_notification' },
      ],
      defaultValue: 'a2a_send_message',
    },
    {
      id: 'agentUrl',
      title: 'Agent URL',
      type: 'short-input',
      placeholder: 'https://api.example.com/a2a/serve/agent-id',
      required: true,
      description: 'The A2A endpoint URL',
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Enter your message to the agent...',
      description: 'The message to send to the agent',
      condition: { field: 'operation', value: 'a2a_send_message' },
      required: true,
    },
    {
      id: 'data',
      title: 'Data (JSON)',
      type: 'code',
      placeholder: '{\n  "key": "value"\n}',
      description: 'Structured data to include with the message (DataPart)',
      condition: { field: 'operation', value: 'a2a_send_message' },
    },
    {
      id: 'fileUpload',
      title: 'Files',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload files to send',
      description: 'Files to include with the message (FilePart)',
      condition: { field: 'operation', value: 'a2a_send_message' },
      mode: 'basic',
      multiple: true,
    },
    {
      id: 'fileReference',
      title: 'Files',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'Reference files from previous blocks',
      description: 'Files to include with the message (FilePart)',
      condition: { field: 'operation', value: 'a2a_send_message' },
      mode: 'advanced',
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Task ID',
      description: 'Task ID to query, cancel, continue, or configure',
      condition: {
        field: 'operation',
        value: [
          'a2a_send_message',
          'a2a_get_task',
          'a2a_cancel_task',
          'a2a_resubscribe',
          'a2a_set_push_notification',
          'a2a_get_push_notification',
          'a2a_delete_push_notification',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'a2a_get_task',
          'a2a_cancel_task',
          'a2a_resubscribe',
          'a2a_set_push_notification',
          'a2a_get_push_notification',
          'a2a_delete_push_notification',
        ],
      },
    },
    {
      id: 'contextId',
      title: 'Context ID',
      type: 'short-input',
      placeholder: 'Optional - for multi-turn conversations',
      description: 'Context ID for conversation continuity across tasks',
      condition: { field: 'operation', value: 'a2a_send_message' },
    },
    {
      id: 'historyLength',
      title: 'History Length',
      type: 'short-input',
      placeholder: 'Number of messages to include',
      description: 'Number of history messages to include in the response',
      condition: { field: 'operation', value: 'a2a_get_task' },
    },
    {
      id: 'webhookUrl',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'https://your-app.com/webhook',
      description: 'HTTPS webhook URL to receive task update notifications',
      condition: { field: 'operation', value: 'a2a_set_push_notification' },
      required: { field: 'operation', value: 'a2a_set_push_notification' },
    },
    {
      id: 'token',
      title: 'Webhook Token',
      type: 'short-input',
      password: true,
      placeholder: 'Optional token for webhook validation',
      description: 'Token that will be included in webhook requests for validation',
      condition: { field: 'operation', value: 'a2a_set_push_notification' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Optional API key for authenticated agents',
      description:
        'Optional API key sent via X-API-Key header for agents that require authentication',
    },
  ],
  tools: {
    access: [
      'a2a_send_message',
      'a2a_get_task',
      'a2a_cancel_task',
      'a2a_get_agent_card',
      'a2a_resubscribe',
      'a2a_set_push_notification',
      'a2a_get_push_notification',
      'a2a_delete_push_notification',
    ],
    config: {
      tool: (params) => params.operation as string,
      params: (params) => {
        const { files, ...rest } = params
        const normalizedFiles = normalizeFileInput(files)
        return {
          ...rest,
          ...(normalizedFiles && { files: normalizedFiles }),
        }
      },
    },
  },
  inputs: {
    operation: {
      type: 'string',
      description: 'A2A operation to perform',
    },
    agentUrl: {
      type: 'string',
      description: 'A2A endpoint URL',
    },
    message: {
      type: 'string',
      description: 'Message to send to the agent',
    },
    taskId: {
      type: 'string',
      description: 'Task ID to query, cancel, continue, or configure',
    },
    contextId: {
      type: 'string',
      description: 'Context ID for conversation continuity',
    },
    data: {
      type: 'json',
      description: 'Structured data to include with the message',
    },
    files: {
      type: 'array',
      description: 'Files to include with the message (canonical param)',
    },
    historyLength: {
      type: 'number',
      description: 'Number of history messages to include',
    },
    webhookUrl: {
      type: 'string',
      description: 'HTTPS webhook URL for push notifications',
    },
    token: {
      type: 'string',
      description: 'Token for webhook validation',
    },
    apiKey: {
      type: 'string',
      description: 'API key for authentication',
    },
  },
  outputs: {
    content: {
      type: 'string',
      description: 'The text response from the agent',
    },
    taskId: {
      type: 'string',
      description: 'Task ID for follow-up interactions',
    },
    contextId: {
      type: 'string',
      description: 'Context ID for conversation continuity',
    },
    state: {
      type: 'string',
      description: 'Task state (completed, failed, etc.)',
    },
    artifacts: {
      type: 'array',
      description: 'Structured output artifacts from the agent',
    },
    history: {
      type: 'array',
      description: 'Full message history of the conversation',
    },
    cancelled: {
      type: 'boolean',
      description: 'Whether the task was successfully cancelled',
    },
    isRunning: {
      type: 'boolean',
      description: 'Whether the task is still running',
    },
    name: {
      type: 'string',
      description: 'Agent name',
    },
    description: {
      type: 'string',
      description: 'Agent description',
    },
    url: {
      type: 'string',
      description: 'Agent endpoint URL',
    },
    version: {
      type: 'string',
      description: 'Agent version',
    },
    capabilities: {
      type: 'json',
      description: 'Agent capabilities (streaming, pushNotifications, etc.)',
    },
    skills: {
      type: 'array',
      description: 'Skills the agent can perform',
    },
    authentication: {
      type: 'json',
      description: 'Supported authentication schemes',
    },
    webhookUrl: {
      type: 'string',
      description: 'Configured webhook URL',
    },
    token: {
      type: 'string',
      description: 'Webhook validation token',
    },
    exists: {
      type: 'boolean',
      description: 'Whether push notification config exists',
    },
    success: {
      type: 'boolean',
      description: 'Whether the operation was successful',
    },
  },
}
