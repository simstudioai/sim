import { WarnIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { BarrierExtractorResponse } from '@/tools/barrier_extractor/types'

export const BarrierExtractorBlock: BlockConfig<BarrierExtractorResponse> = {
  type: 'barrierExtractor',
  name: 'Barrier Extractor',
  description: 'Extract and analyze barriers preventing objectives achievement',
  longDescription: 'Identify obstacles, challenges, and barriers that may prevent your target audience from achieving objectives in specific regions.',
  docsLink: 'https://docs.sim.ai/tools/barrier-extractor',
  category: 'tools',
  bgColor: '#E74C3C',
  icon: WarnIcon,
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
    access: ['barrier_extractor_execute'],
  },
  inputs: {
    objective: { type: 'string', description: 'Objective to analyze barriers for' },
    region: { type: 'string', description: 'Target region' },
    targetAudience: { type: 'string', description: 'Target audience' },
  },
  outputs: {
    content: { type: 'string', description: 'Barrier extractor results' },
  },
}