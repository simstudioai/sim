import { BrainIcon } from '@/components/icons'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

interface ThinkingToolResponse extends ToolResponse {
  output: {
    acknowledgedThought: string
  }
}

export const ThinkingBlock: BlockConfig<ThinkingToolResponse> = {
  type: 'thinking',
  name: 'Thinking',
  description: 'Forces model to outline its thought process.',
  longDescription:
    'Adds a step where the model explicitly outlines its thought process before proceeding. This can improve reasoning quality by encouraging step-by-step analysis.',
  docsLink: 'https://docs.simstudio.ai/tools/thinking',
  category: 'tools',
  bgColor: '#181C1E',
  icon: BrainIcon,
  hideFromToolbar: true,

  subBlocks: [
    {
      id: 'thought',
      title: 'Thought Process / Instruction',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Describe the step-by-step thinking process here...',
      hidden: true,
    },
  ],

  inputs: {
    thought: { type: 'string', required: true },
  },

  outputs: {
    response: {
      type: {
        acknowledgedThought: 'string',
      },
    },
  },

  tools: {
    access: ['thinking_tool'],
  },
}
