import { Blimp } from '@/components/emcn'
import type { BlockConfig } from '@/blocks/types'
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
  ],
  tools: {
    access: [],
  },
  inputs: {
    prompt: {
      type: 'string',
      description: 'The prompt to send to the Mothership AI agent',
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
