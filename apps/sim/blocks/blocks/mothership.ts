import { Blimp } from '@/components/emcn'
import type { BlockConfig } from '@/blocks/types'
import { RESPONSE_FORMAT_WAND_CONFIG } from '@/blocks/utils'
import type { ToolResponse } from '@/tools/types'

interface MothershipResponse extends ToolResponse {
  output: {
    content: string
    model: string
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
  - Response Format should be a valid JSON Schema. When present, structured fields are returned at root level (e.g. <mothership1.field>). Without it, the block returns content, model, and tokens.
  - The Mothership picks its own model and tools internally — you only provide messages and an optional response format.
  `,
  category: 'blocks',
  bgColor: '#802FDE',
  icon: Blimp,
  subBlocks: [
    {
      id: 'messages',
      title: 'Messages',
      type: 'messages-input',
      placeholder: 'Enter messages...',
    },
    {
      id: 'responseFormat',
      title: 'Response Format',
      type: 'code',
      placeholder: 'Enter JSON schema...',
      language: 'json',
      mode: 'advanced',
      wandConfig: RESPONSE_FORMAT_WAND_CONFIG,
    },
    {
      id: 'memoryType',
      title: 'Memory',
      type: 'dropdown',
      placeholder: 'Select memory...',
      options: [
        { label: 'None', id: 'none' },
        { label: 'Conversation', id: 'conversation' },
      ],
      mode: 'advanced',
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'e.g., user-123, session-abc',
      required: {
        field: 'memoryType',
        value: ['conversation'],
      },
      condition: {
        field: 'memoryType',
        value: ['conversation'],
      },
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    messages: {
      type: 'json',
      description:
        'Array of message objects with role and content: [{ role: "system", content: "..." }, { role: "user", content: "..." }]',
    },
    responseFormat: {
      type: 'json',
      description: 'JSON response format schema for structured output',
    },
    memoryType: {
      type: 'string',
      description: 'Type of memory: none (default) or conversation',
    },
    conversationId: {
      type: 'string',
      description: 'Persistent conversation ID for memory across executions',
    },
  },
  outputs: {
    content: { type: 'string', description: 'Generated response content' },
    model: { type: 'string', description: 'Model used for generation' },
    tokens: { type: 'json', description: 'Token usage statistics' },
    toolCalls: { type: 'json', description: 'Tool calls made during execution' },
    cost: { type: 'json', description: 'Cost of the execution' },
  },
}
