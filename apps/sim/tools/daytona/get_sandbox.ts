import type { DaytonaGetSandboxParams, DaytonaSandboxResponse } from '@/tools/daytona/types'
import {
  DAYTONA_API_BASE_URL,
  DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
  encodeSandboxId,
  extractDaytonaError,
  mapDaytonaSandbox,
} from '@/tools/daytona/utils'
import type { ToolConfig } from '@/tools/types'

export const daytonaGetSandboxTool: ToolConfig<DaytonaGetSandboxParams, DaytonaSandboxResponse> = {
  id: 'daytona_get_sandbox',
  name: 'Daytona Get Sandbox',
  description: 'Get details of a Daytona sandbox',
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
    url: (params) => `${DAYTONA_API_BASE_URL}/sandbox/${encodeSandboxId(params.sandboxId)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      throw new Error(await extractDaytonaError(response, 'Failed to get sandbox'))
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
      description: 'The sandbox details',
      properties: DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
    },
  },
}
