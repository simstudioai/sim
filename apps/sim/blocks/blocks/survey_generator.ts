import { SurveyGeneratorIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { SurveyGeneratorResponse } from '@/tools/survey_generator/types'

export const SurveyGeneratorBlock: BlockConfig<SurveyGeneratorResponse> = {
  type: 'surveyGenerator',
  name: 'Survey Generator',
  description: 'Generate custom surveys for target audiences',
  longDescription: 'Create tailored survey questions based on objectives, target audience, and regional requirements.',
  docsLink: 'https://docs.sim.ai/tools/survey-generator',
  category: 'tools',
  bgColor: '#16A085',
  icon: SurveyGeneratorIcon,
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
    {
      id: 'numQuestions',
      title: 'Number of Questions',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter number of questions (e.g., 10)',
    },
  ],
  tools: {
    access: ['survey_generator_execute'],
  },
  inputs: {
    objective: { type: 'string', description: 'Survey objective' },
    region: { type: 'string', description: 'Target region' },
    targetAudience: { type: 'string', description: 'Target audience' },
    numQuestions: { type: 'number', description: 'Number of questions to generate' },
  },
  outputs: {
    content: { type: 'string', description: 'Survey generator results' },
  },
}