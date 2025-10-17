import { FocusGroupIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { FocusGroupResponse } from '@/tools/focus_group/types'

export const FocusGroupBlock: BlockConfig<FocusGroupResponse> = {
  type: 'focusGroup',
  name: 'Focus Group',
  description: 'Convert website content into text',
  longDescription: 'Integrate Jina into the workflow. Extracts content from websites.',
  docsLink: 'https://docs.sim.ai/tools/jina',
  category: 'tools',
  bgColor: '#333333',
  icon: FocusGroupIcon,
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
      id: 'region',
      title: 'Region',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the region',
    },
    {
      id: 'targetAudience',
      title: 'Target Audience',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the target audience',
    },
  ],
  tools: {
    access: ['focus_group_execute'],
  },
  inputs: {
    objective: { type: 'string', description: 'Focus group objective' },
    region: { type: 'string', description: 'Target region' },
    targetAudience: { type: 'string', description: 'Target audience' },
  },
  outputs: {
    content: { type: 'string', description: 'Focus group results' },
  },
}
