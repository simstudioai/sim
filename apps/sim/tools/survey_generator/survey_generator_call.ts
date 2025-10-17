import { env } from '@/lib/env'
import type { SurveyGeneratorParams, SurveyGeneratorResponse } from '@/tools/survey_generator/types'
import type { ToolConfig } from '@/tools/types'

export const surveyGeneratorTool: ToolConfig<SurveyGeneratorParams, SurveyGeneratorResponse> = {
  id: 'survey_generator_execute',
  name: 'Survey Generator',
  description:
    'Execute survey generation with specified objective, region, target audience, and number of questions.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The survey objective',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target region',
    },
    targetAudience: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target audience',
    },
    numQuestions: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The number of questions to generate',
    },
  },

  request: {
    url: () => {
      return 'https://sim.ltdan.ai/api/workflows/55c5e875-cbcf-4a0f-bc36-377fed0c43b6/execute'
    },
    method: 'POST',
    headers: () => {
      const apiKey = env.FOCUS_GROUP_API_KEY
      if (!apiKey) {
        throw new Error('FOCUS_GROUP_API_KEY environment variable is required')
      }
      return {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      }
    },
    body: (params: SurveyGeneratorParams) => {
      return {
        objective: params.objective,
        targetaudience: params.targetAudience,
        region: params.region,
        numQuestions: params.numQuestions,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const content = await response.text()
    return {
      success: response.ok,
      output: {
        content,
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'The survey generation results',
    },
  },
}