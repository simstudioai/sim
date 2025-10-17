import { AgentIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { PersuasionSupportEngineResponse } from '@/tools/persuasion_support_engine/types'

export const PersuasionSupportEngineBlock: BlockConfig<PersuasionSupportEngineResponse> = {
  type: 'persuasionSupportEngine',
  name: 'Persuasion Support Engine',
  description: 'Enhance message persuasiveness for target audiences',
  longDescription: 'Analyze and enhance the persuasive power of messages to maximize impact with specific target audiences.',
  docsLink: 'https://docs.sim.ai/tools/persuasion-support-engine',
  category: 'tools',
  bgColor: '#E67E22',
  icon: AgentIcon,
  subBlocks: [
    {
      id: 'objective',
      title: 'Objective',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the objective',
    },
    {
      id: 'supportingObjective',
      title: 'Supporting Objective',
      type: 'short-input',
      layout: 'full',
      required: false,
      placeholder: 'Enter supporting objective (optional)',
    },
    {
      id: 'targetAudience',
      title: 'Target Audience',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the target audience',
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the region',
    },
    {
      id: 'messages',
      title: 'Messages',
      type: 'long-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter messages to enhance persuasiveness',
    },
  ],
  tools: {
    access: ['persuasion_support_engine_execute'],
  },
  inputs: {
    objective: { type: 'string', description: 'Persuasion objective' },
    supportingObjective: { type: 'string', description: 'Supporting objective (optional)' },
    targetAudience: { type: 'string', description: 'Target audience' },
    region: { type: 'string', description: 'Target region' },
    messages: { type: 'string', description: 'Messages to enhance' },
  },
  outputs: {
    content: { type: 'string', description: 'Persuasion support engine results' },
  },
}