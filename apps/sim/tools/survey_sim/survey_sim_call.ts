import { env } from '@/lib/env'
import type { SurveySimParams, SurveySimResponse } from '@/tools/survey_sim/types'
import type { ToolConfig } from '@/tools/types'

export const surveySimTool: ToolConfig<SurveySimParams, SurveySimResponse> = {
  id: 'survey_sim_execute',
  name: 'Survey Simulator',
  description:
    'Execute a survey simulation with specified objective, region, target audience, and survey questions.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The objective of the survey',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target region for the survey',
    },
    targetAudience: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target audience for the survey',
    },
    surveyQuestions: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The survey questions to simulate responses for',
    },
  },

  request: {
    url: () => {
      return 'https://sim.ltdan.ai/api/workflows/6c2c7975-afe5-4e8c-a6be-52dee07c0e58/execute'
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
    body: (params: SurveySimParams) => {
      return {
        targetaudience: params.targetAudience,
        objective: params.objective,
        region: params.region,
        questions: params.surveyQuestions,
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
      description: 'The survey simulation results',
    },
  },
}