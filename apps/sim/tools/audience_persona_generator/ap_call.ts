import { env } from '@/lib/env'
import type { AudiencePersonaGeneratorRequest, AudiencePersonaGeneratorResponse } from '@/tools/audience_persona_generator/types'
import type { ToolConfig } from '@/tools/types'

export const audiencePersonaGeneratorTool: ToolConfig<AudiencePersonaGeneratorRequest, AudiencePersonaGeneratorResponse> = {
  id: 'audience_persona_generator_execute',
  name: 'Audience Persona Generator',
  description:
    'Generate detailed audience personas based on objective, target audience, region, and number of personas.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The objective for persona generation',
    },
    targetAudience: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target audience description',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The geographic region',
    },
    numPersonas: {
      type: 'integer',
      required: true,
      visibility: 'user-or-llm',
      description: 'The number of personas to generate',
    },
  },

  request: {
    url: () => {
      return 'https://sim.ltdan.ai/api/workflows/bfa1a1a3-f133-4437-a881-c8e4f7d690f8/execute'
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
    body: (params: AudiencePersonaGeneratorRequest) => {
      return {
        objective: params.objective,
        targetaudience: params.targetAudience,
        region: params.region,
        numPersonas: params.numPersonas,
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
      description: 'The generated audience personas',
    },
  },
}