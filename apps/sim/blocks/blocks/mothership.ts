import { MothershipBlockDisplay } from '@/blocks/blocks/mothership.display'
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
  ...MothershipBlockDisplay,
  bestPractices: `
  - Use for tasks that require multi-step reasoning, tool use, or cross-service coordination.
  - Sim picks its own model and tools internally — you only provide a prompt.
  `,
  subBlocks: [
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Enter your prompt for Sim...',
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
  ],
  tools: {
    access: [],
  },
  inputs: {
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
