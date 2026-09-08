import { Blimp } from '@sim/emcn/icons'
import { MOTHERSHIP_EFFORT_OPTIONS, MOTHERSHIP_MODEL_OPTIONS } from '@/lib/mothership/model-options'
import type { BlockConfig } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

interface MothershipResponse extends ToolResponse {
  output: {
    content: string
    model: string
    conversationId?: string
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
  }
}

export const MothershipBlock: BlockConfig<MothershipResponse> = {
  type: 'mothership',
  name: 'Sim Chat',
  description: 'Talk to Sim',
  longDescription:
    'The Sim Chat block sends a prompt with selected integration tools, files, and skill context for a one-shot response within a workflow.',
  bestPractices: `
  - Use for tasks that require multi-step reasoning, tool use, or cross-service coordination.
  - Choose Astra or Opus and a reasoning effort. Astra supports Fast mode.
  `,
  category: 'blocks',
  bgColor: '#802FDE',
  icon: Blimp,
  canvasPresentation: {
    defaultTitle: 'Sim Chat',
    sentences: {
      default: [
        { text: 'Ask', field: 'prompt', core: true },
        { text: ', with', field: ['attachmentFiles', 'fileReferences'], after: 'attached' },
        { text: ', using', field: 'tools' },
      ],
    },
  },
  subBlocks: [
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Enter your prompt for Sim...',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: MOTHERSHIP_MODEL_OPTIONS.map(({ value, label }) => ({ id: value, label })),
      value: () => 'gpt-6-astra',
    },
    {
      id: 'effort',
      title: 'Reasoning Effort',
      type: 'dropdown',
      options: MOTHERSHIP_EFFORT_OPTIONS.map(({ value, label }) => ({ id: value, label })),
      value: () => 'high',
    },
    {
      id: 'fastMode',
      title: 'Fast',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'model', value: 'gpt-6-astra' },
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'e.g., user-123, session-abc, customer-456',
    },
    {
      id: 'attachmentFiles',
      title: 'Attachments',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload files to attach',
      mode: 'basic',
      multiple: true,
      required: false,
    },
    {
      id: 'fileReferences',
      title: 'Attachments',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'Reference files from previous blocks',
      mode: 'advanced',
      required: false,
    },
    {
      id: 'tools',
      title: 'Tools',
      type: 'tool-input',
      defaultValue: [],
    },
    {
      id: 'skills',
      title: 'Skills',
      type: 'skill-input',
      defaultValue: [],
    },
    {
      id: 'secretScope',
      title: 'Secret access',
      type: 'dropdown',
      mode: 'advanced',
      hideFromCopilot: true,
      options: [
        { label: 'All secrets', id: 'all' },
        { label: 'Selected secrets', id: 'selected' },
      ],
      value: () => 'all',
    },
    {
      id: 'mountedSecrets',
      title: 'Secrets',
      type: 'dropdown',
      selectorKey: 'workspace.rawSecretNames',
      mode: 'advanced',
      hideFromCopilot: true,
      multiSelect: true,
      searchable: true,
      preserveLabelCase: true,
      condition: { field: 'secretScope', value: 'selected' },
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    model: { type: 'string', description: 'Astra or Opus from the supported model catalog' },
    effort: { type: 'string', description: 'Reasoning effort: low, medium, high, xhigh, or max' },
    fastMode: { type: 'boolean', description: 'Enable Fast mode for Astra' },
    prompt: {
      type: 'string',
      description: 'The prompt to send to Sim',
    },
    conversationId: {
      type: 'string',
      description: 'Chat ID to continue; generated when omitted',
    },
    files: {
      type: 'file',
      description: 'Files to send to Sim as attachments',
    },
    tools: { type: 'json', description: 'MCP tools available to Sim for this request' },
    skills: { type: 'json', description: 'Skills activated for this request' },
    secretScope: { type: 'string', description: 'Secret access mode: all or selected' },
    mountedSecrets: { type: 'json', description: 'Secret names available to Sim code execution' },
  },
  outputs: {
    content: { type: 'string', description: 'Generated response content' },
    model: { type: 'string', description: 'Model used for generation' },
    conversationId: { type: 'string', description: 'Chat ID used for this request' },
    tokens: { type: 'json', description: 'Token usage statistics' },
    toolCalls: { type: 'json', description: 'Tool calls made during execution' },
    cost: { type: 'json', description: 'Cost of the execution' },
  },
}
