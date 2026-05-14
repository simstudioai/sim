import { Blimp } from '@/components/emcn'
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
  name: 'Mothership',
  description: 'Query the Mothership AI agent',
  longDescription:
    'The Mothership block sends messages to the Mothership AI agent, which has access to subagents, integration tools, memory, and workspace context. Use it to perform complex multi-step reasoning, cross-service queries, or any task that benefits from the full Mothership intelligence within a workflow.',
  bestPractices: `
  - Use for tasks that require multi-step reasoning, tool use, or cross-service coordination.
  - The Mothership picks its own model and tools internally — you only provide a prompt.
  `,
  category: 'blocks',
  bgColor: '#802FDE',
  icon: Blimp,
  subBlocks: [
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Enter your prompt for the Mothership...',
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
      description: 'The prompt to send to the Mothership AI agent',
    },
    conversationId: {
      type: 'string',
      description: 'Mothership chat ID to continue; generated when omitted',
    },
    files: {
      type: 'file',
      description: 'Files to send to Mothership as attachments',
    },
  },
  outputs: {
    content: { type: 'string', description: 'Generated response content' },
    model: { type: 'string', description: 'Model used for generation' },
    conversationId: { type: 'string', description: 'Mothership chat ID used for this request' },
    tokens: { type: 'json', description: 'Token usage statistics' },
    toolCalls: { type: 'json', description: 'Tool calls made during execution' },
    cost: { type: 'json', description: 'Cost of the execution' },
  },
}
