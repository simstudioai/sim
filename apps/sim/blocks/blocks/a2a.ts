import { A2AIcon } from '@/components/icons'
import { type BlockConfig, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'

export const A2ABlock: BlockConfig = {
  type: 'a2a',
  name: 'A2A',
  description: 'Interact with external A2A-compatible agents',
  longDescription:
    'Use the A2A (Agent-to-Agent) protocol to call external AI agents. Send messages, ' +
    'track or cancel tasks, and discover an agent\u2019s capabilities via its Agent Card. ' +
    'Compatible with any A2A-compliant agent.',
  docsLink: 'https://docs.sim.ai/integrations/a2a',
  category: 'blocks',
  integrationType: IntegrationType.DevOps,
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
      ],
      defaultValue: 'a2a_send_message',
    },
    {
      id: 'agentUrl',
      title: 'Agent URL',
      type: 'short-input',
      placeholder: 'https://api.example.com/a2a',
      description: 'The A2A endpoint URL',
      required: true,
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Enter your message to the agent...',
      description: 'The message to send to the agent',
      condition: { field: 'operation', value: 'a2a_send_message' },
      required: { field: 'operation', value: 'a2a_send_message' },
    },
    {
      id: 'data',
      title: 'Data (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "key": "value"\n}',
      description: 'Optional structured data to include with the message',
      condition: { field: 'operation', value: 'a2a_send_message' },
    },
    {
      id: 'fileUpload',
      title: 'Files',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload files to send',
      description: 'Optional files to include with the message',
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
      description: 'Optional files to include with the message',
      condition: { field: 'operation', value: 'a2a_send_message' },
      mode: 'advanced',
    },
    {
      id: 'contextId',
      title: 'Context ID',
      type: 'short-input',
      placeholder: 'Optional - for multi-turn conversations',
      description: 'Context ID for conversation continuity',
      condition: { field: 'operation', value: 'a2a_send_message' },
      mode: 'advanced',
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Task ID',
      description: 'Task to continue, query, or cancel',
      condition: {
        field: 'operation',
        value: ['a2a_send_message', 'a2a_get_task', 'a2a_cancel_task'],
      },
      required: { field: 'operation', value: ['a2a_get_task', 'a2a_cancel_task'] },
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
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Optional API key for authenticated agents',
      description: 'Sent via the X-API-Key header for agents that require authentication',
    },
  ],

  tools: {
    access: ['a2a_send_message', 'a2a_get_task', 'a2a_cancel_task', 'a2a_get_agent_card'],
    config: {
      tool: (params) => params.operation as string,
      params: (params) => {
        const { files, historyLength, ...rest } = params
        const normalizedFiles = normalizeFileInput(files)
        const parsedHistoryLength = parseOptionalNumberInput(historyLength, 'History Length', {
          integer: true,
          min: 1,
          max: 1000,
        })
        return {
          ...rest,
          ...(normalizedFiles ? { files: normalizedFiles } : {}),
          ...(parsedHistoryLength !== undefined ? { historyLength: parsedHistoryLength } : {}),
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'A2A operation to perform' },
    agentUrl: { type: 'string', description: 'A2A endpoint URL' },
    message: { type: 'string', description: 'Message to send to the agent' },
    data: { type: 'json', description: 'Structured data to include with the message' },
    files: { type: 'array', description: 'Files to include with the message (canonical param)' },
    contextId: { type: 'string', description: 'Context ID for conversation continuity' },
    taskId: { type: 'string', description: 'Task ID to continue, query, or cancel' },
    historyLength: { type: 'number', description: 'Number of history messages to include' },
    apiKey: { type: 'string', description: 'API key for authentication' },
  },

  outputs: {
    content: { type: 'string', description: 'Agent response text' },
    taskId: { type: 'string', description: 'Task identifier' },
    contextId: { type: 'string', description: 'Conversation/context identifier' },
    state: { type: 'string', description: 'Task lifecycle state' },
    artifacts: { type: 'array', description: 'Structured task output artifacts' },
    canceled: { type: 'boolean', description: 'Whether the task was canceled' },
    name: { type: 'string', description: 'Agent display name' },
    description: { type: 'string', description: 'Agent description' },
    url: { type: 'string', description: 'Agent endpoint URL' },
    version: { type: 'string', description: "Agent's own version" },
    protocolVersion: { type: 'string', description: 'A2A protocol version' },
    capabilities: { type: 'json', description: 'Agent capability flags' },
    skills: { type: 'array', description: 'Agent skills' },
    defaultInputModes: { type: 'array', description: 'Default input media types' },
    defaultOutputModes: { type: 'array', description: 'Default output media types' },
  },
}
