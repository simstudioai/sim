import type { GetSecuritySignalParams, GetSecuritySignalResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const getSecuritySignalTool: ToolConfig<GetSecuritySignalParams, GetSecuritySignalResponse> =
  {
    id: 'datadog_get_security_signal',
    name: 'Datadog Get Security Signal',
    description:
      'Get the details of a single Cloud SIEM security signal. Requires the `security_monitoring_signals_read` permission.',
    version: '1.0.0',

    params: {
      signalId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the security signal',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Datadog API key',
      },
      applicationKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Datadog Application key',
      },
      site: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Datadog site/region (default: datadoghq.com)',
      },
    },

    request: {
      url: (params) =>
        datadogApiUrl(
          params.site,
          `/api/v2/security_monitoring/signals/${datadogPathSegment(params.signalId)}`
        ),
      method: 'GET',
      headers: datadogHeaders,
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        return {
          success: false,
          output: { signal: { attributes: {} } },
          error: await datadogErrorMessage(response),
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          signal: {
            id: data.data?.id,
            type: data.data?.type,
            attributes: data.data?.attributes ?? {},
          },
        },
      }
    },

    outputs: {
      signal: {
        type: 'object',
        description: 'The security signal',
        properties: {
          id: { type: 'string', description: 'Signal ID' },
          type: { type: 'string', description: 'Resource type (signal)' },
          attributes: {
            type: 'object',
            description: 'Signal attributes',
            properties: {
              message: { type: 'string', description: 'Message from the detection rule' },
              timestamp: { type: 'string', description: 'Signal timestamp' },
              tags: { type: 'array', description: 'Tags on the signal' },
              custom: { type: 'object', description: 'Signal-specific attributes' },
            },
          },
        },
      },
    },
  }
