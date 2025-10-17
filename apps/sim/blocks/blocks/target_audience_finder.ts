import { UsersIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { TAFinderResponse } from '@/tools/target_audience_finder/types'

export const TAFinderBlock: BlockConfig<TAFinderResponse> = {
  type: 'taFinder',
  name: 'Target Audience Finder',
  description: 'Find and analyze target audiences for your objectives',
  longDescription: 'Discover the most relevant target audiences based on your objectives and regional requirements.',
  docsLink: 'https://docs.sim.ai/tools/target-audience-finder',
  category: 'tools',
  bgColor: '#E67E22',
  icon: UsersIcon,
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
      id: 'supportingObjective',
      title: 'Supporting Objective',
      type: 'short-input',
      layout: 'full',
      required: false,
      placeholder: 'Enter supporting objective (optional)',
    },
  ],
  tools: {
    access: ['ta_finder_execute'],
  },
  inputs: {
    objective: { type: 'string', description: 'Main objective' },
    region: { type: 'string', description: 'Target region' },
    supportingObjective: { type: 'string', description: 'Supporting objective (optional)' },
  },
  outputs: {
    content: { type: 'string', description: 'Target audience finder results' },
  },
}