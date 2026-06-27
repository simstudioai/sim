import { ThinkingBlockDisplay } from '@/blocks/blocks/thinking.display'
import type { BlockConfig } from '@/blocks/types'
import type { ThinkingToolResponse } from '@/tools/thinking/types'

export const ThinkingBlock: BlockConfig<ThinkingToolResponse> = {
  ...ThinkingBlockDisplay,
  subBlocks: [
    {
      id: 'thought',
      title: 'Thought Process / Instruction',
      type: 'long-input',
      placeholder: 'Describe the step-by-step thinking process here...',
      hidden: true,
      required: true,
    },
  ],

  inputs: {
    thought: { type: 'string', description: 'Thinking process instructions' },
  },

  outputs: {
    acknowledgedThought: { type: 'string', description: 'Acknowledged thought process' },
  },

  tools: {
    access: ['thinking_tool'],
  },
}
