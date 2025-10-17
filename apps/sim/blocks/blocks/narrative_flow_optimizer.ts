import { WorkflowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { NarrativeFlowOptimizerResponse } from '@/tools/narrative_flow_optimizer/types'

export const NarrativeFlowOptimizerBlock: BlockConfig<NarrativeFlowOptimizerResponse> = {
  type: 'narrativeFlowOptimizer',
  name: 'Narrative Flow Optimizer',
  description: 'Optimize narrative flow for target audiences',
  longDescription: 'Analyze and optimize narrative structures to improve engagement and effectiveness with specific target audiences.',
  docsLink: 'https://docs.sim.ai/tools/narrative-flow-optimizer',
  category: 'tools',
  bgColor: '#2ECC71',
  icon: WorkflowIcon,
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
      id: 'narrative',
      title: 'Narrative',
      type: 'long-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter your narrative to optimize',
    },
  ],
  tools: {
    access: ['narrative_flow_optimizer_execute'],
  },
  inputs: {
    objective: { type: 'string', description: 'Optimization objective' },
    supportingObjective: { type: 'string', description: 'Supporting objective (optional)' },
    targetAudience: { type: 'string', description: 'Target audience' },
    region: { type: 'string', description: 'Target region' },
    narrative: { type: 'string', description: 'Narrative content to optimize' },
  },
  outputs: {
    content: { type: 'string', description: 'Narrative flow optimizer results' },
  },
}