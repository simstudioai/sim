import { FocusGroupIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { AudiencePersonaGeneratorResponse } from '@/tools/audience_persona_generator/types'

export const AudiencePersonaGeneratorBlock: BlockConfig<AudiencePersonaGeneratorResponse> = {
  type: 'audiencePersonaGenerator',
  name: 'Audience Persona Generator',
  description: 'Generate detailed audience personas for your target market',
  longDescription: 'Create comprehensive audience personas based on your objective, target audience, and region to better understand your market.',
  docsLink: 'https://docs.sim.ai/tools/audience-persona-generator',
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
      placeholder: 'Enter the objective for persona generation',
    },
    {
      id: 'numPersonas',
      title: 'Number of Personas',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter number of personas to generate',
    },
    {
      id: 'targetAudience',
      title: 'Target Audience',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Describe your target audience',
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the geographic region',
    },
  ],
  tools: {
    access: ['audience_persona_generator_execute'],
  },
  inputs: {
    objective: { type: 'string', description: 'Objective for persona generation' },
    numPersonas: { type: 'number', description: 'Number of personas to generate' },
    targetAudience: { type: 'string', description: 'Target audience description' },
    region: { type: 'string', description: 'Geographic region' },
  },
  outputs: {
    content: { type: 'string', description: 'Generated audience personas' },
  },
}