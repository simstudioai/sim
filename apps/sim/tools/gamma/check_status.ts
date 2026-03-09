import type { GammaCheckStatusParams, GammaCheckStatusResponse } from '@/tools/gamma/types'
import type { ToolConfig } from '@/tools/types'

export const checkStatusTool: ToolConfig<GammaCheckStatusParams, GammaCheckStatusResponse> = {
  id: 'gamma_check_status',
  name: 'Gamma Check Status',
  description:
    'Check the status of a Gamma generation job. Returns the gamma URL when completed, or error details if failed.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gamma API key',
    },
    generationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The generation ID returned by the Generate or Generate from Template tool',
    },
  },

  request: {
    url: (params) => `https://public-api.gamma.app/v1.0/generations/${params.generationId}`,
    method: 'GET',
    headers: (params) => ({
      'X-API-KEY': params.apiKey,
    }),
  },

  transformResponse: async (response: Response): Promise<GammaCheckStatusResponse> => {
    const data = await response.json()

    const output: GammaCheckStatusResponse['output'] = {
      generationId: data.generationId ?? '',
      status: data.status ?? 'pending',
      gammaUrl: data.gammaUrl ?? null,
    }

    if (data.credits) {
      output.credits = {
        deducted: data.credits.deducted ?? null,
        remaining: data.credits.remaining ?? null,
      }
    }

    if (data.error) {
      output.error = {
        message: data.error.message ?? null,
        statusCode: data.error.statusCode ?? null,
      }
    }

    return { success: true, output }
  },

  outputs: {
    generationId: {
      type: 'string',
      description: 'The generation ID that was checked',
    },
    status: {
      type: 'string',
      description: 'Generation status: pending, completed, or failed',
    },
    gammaUrl: {
      type: 'string',
      description: 'URL of the generated gamma (only present when status is completed)',
      optional: true,
    },
    credits: {
      type: 'object',
      description: 'Credit usage information (only present when status is completed)',
      optional: true,
      properties: {
        deducted: {
          type: 'number',
          description: 'Number of credits deducted for this generation',
          optional: true,
        },
        remaining: {
          type: 'number',
          description: 'Remaining credits in the account',
          optional: true,
        },
      },
    },
    error: {
      type: 'object',
      description: 'Error details (only present when status is failed)',
      optional: true,
      properties: {
        message: {
          type: 'string',
          description: 'Human-readable error message',
          optional: true,
        },
        statusCode: {
          type: 'number',
          description: 'HTTP status code of the error',
          optional: true,
        },
      },
    },
  },
}
