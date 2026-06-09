import type {
  SendblueEvaluateServiceParams,
  SendblueEvaluateServiceResponse,
} from '@/tools/sendblue/types'
import {
  SENDBLUE_API_BASE_URL,
  sendblueBaseParamFields,
  sendblueHeaders,
} from '@/tools/sendblue/utils'
import type { ToolConfig } from '@/tools/types'

export const sendblueEvaluateServiceTool: ToolConfig<
  SendblueEvaluateServiceParams,
  SendblueEvaluateServiceResponse
> = {
  id: 'sendblue_evaluate_service',
  name: 'Sendblue Evaluate Service',
  description: 'Check whether a phone number can receive iMessage or only SMS.',
  version: '1.0.0',

  params: {
    ...sendblueBaseParamFields,
    number: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Phone number to evaluate, in E.164 format (e.g., +19998887777)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${SENDBLUE_API_BASE_URL}/api/evaluate-service`)
      url.searchParams.set('number', params.number.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => sendblueHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        number: data.number ?? null,
        service: data.service ?? null,
      },
    }
  },

  outputs: {
    number: { type: 'string', description: 'The evaluated phone number in E.164 format' },
    service: { type: 'string', description: 'The service the number supports: iMessage or SMS' },
  },
}
