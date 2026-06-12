import type { DaytonaSandboxResponse, DaytonaStartSandboxParams } from '@/tools/daytona/types'
import {
  DAYTONA_API_BASE_URL,
  DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
  extractDaytonaError,
  mapDaytonaSandbox,
} from '@/tools/daytona/utils'
import type { ToolConfig } from '@/tools/types'

export const daytonaStartSandboxTool: ToolConfig<
  DaytonaStartSandboxParams,
  DaytonaSandboxResponse
> = {
  id: 'daytona_start_sandbox',
  name: 'Daytona Start Sandbox',
  description: 'Start a stopped Daytona sandbox',
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
      `${DAYTONA_API_BASE_URL}/sandbox/${encodeURIComponent(params.sandboxId.trim())}/start`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      throw new Error(await extractDaytonaError(response, 'Failed to start sandbox'))
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
      description: 'The started sandbox',
      properties: DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
    },
  },
}
