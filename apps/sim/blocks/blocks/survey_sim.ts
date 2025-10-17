import { TypeformIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { SurveySimResponse } from '@/tools/survey_sim/types'

export const SurveySimBlock: BlockConfig<SurveySimResponse> = {
  type: 'surveySim',
  name: 'Survey Simulator',
  description: 'Simulate survey responses based on target audience and survey questions',
  longDescription: 'Simulate realistic survey responses from target demographics using AI.',
  docsLink: 'https://docs.sim.ai/tools/survey-simulator',
  category: 'tools',
  bgColor: '#FF6B35',
  icon: TypeformIcon,
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
      id: 'surveyQuestions',
      title: 'Survey Questions',
      type: 'long-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter your survey questions',
    },
  ],
  tools: {
    access: ['survey_sim_execute'],
  },
  inputs: {
    objective: { type: 'string', description: 'Survey objective' },
    region: { type: 'string', description: 'Target region' },
    targetAudience: { type: 'string', description: 'Target audience' },
    surveyQuestions: { type: 'string', description: 'Survey questions to ask' },
  },
  outputs: {
    content: { type: 'string', description: 'Survey simulation results' },
  },
}