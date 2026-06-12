import type { DaytonaSandboxResponse, DaytonaStopSandboxParams } from '@/tools/daytona/types'
import {
  DAYTONA_API_BASE_URL,
  DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
  extractDaytonaError,
  mapDaytonaSandbox,
} from '@/tools/daytona/utils'
import type { ToolConfig } from '@/tools/types'

export const daytonaStopSandboxTool: ToolConfig<DaytonaStopSandboxParams, DaytonaSandboxResponse> =
  {
    id: 'daytona_stop_sandbox',
    name: 'Daytona Stop Sandbox',
    description: 'Stop a running Daytona sandbox',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Daytona API key',
      },
      sandboxId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID or name of the sandbox',
      },
    },

    request: {
      url: (params) =>
        `${DAYTONA_API_BASE_URL}/sandbox/${encodeURIComponent(params.sandboxId.trim())}/stop`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
      }),
    },

    transformResponse: async (response) => {
      if (!response.ok) {
        throw new Error(await extractDaytonaError(response, 'Failed to stop sandbox'))
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          sandbox: mapDaytonaSandbox(data),
        },
      }
    },

    outputs: {
      sandbox: {
        type: 'json',
        description: 'The stopped sandbox',
        properties: DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
      },
    },
  }
