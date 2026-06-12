import type { DaytonaDeleteSandboxParams, DaytonaSandboxResponse } from '@/tools/daytona/types'
import {
  DAYTONA_API_BASE_URL,
  DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
  encodeSandboxId,
  extractDaytonaError,
  mapDaytonaSandbox,
  parseDaytonaJson,
} from '@/tools/daytona/utils'
import type { ToolConfig } from '@/tools/types'

export const daytonaDeleteSandboxTool: ToolConfig<
  DaytonaDeleteSandboxParams,
  DaytonaSandboxResponse
> = {
  id: 'daytona_delete_sandbox',
  name: 'Daytona Delete Sandbox',
  description: 'Delete a Daytona sandbox',
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
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      throw new Error(await extractDaytonaError(response, 'Failed to delete sandbox'))
    }
    const data = await parseDaytonaJson(response)
    const sandbox = mapDaytonaSandbox(data)
    if (!sandbox.id && params) {
      sandbox.id = params.sandboxId.trim()
    }
    return {
      success: true,
      output: {
        sandbox,
      },
    }
  },

  outputs: {
    sandbox: {
      type: 'json',
      description: 'The deleted sandbox',
      properties: DAYTONA_SANDBOX_OUTPUT_PROPERTIES,
    },
  },
}
