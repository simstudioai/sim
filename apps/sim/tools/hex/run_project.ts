import type { HexRunProjectParams, HexRunProjectResponse } from '@/tools/hex/types'
import { HEX_RUN_OUTPUT_PROPERTIES } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const runProjectTool: ToolConfig<HexRunProjectParams, HexRunProjectResponse> = {
  id: 'hex_run_project',
  name: 'Hex Run Project',
  description:
    'Execute a published Hex project. Optionally pass input parameters and control caching behavior.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the Hex project to run',
    },
    inputParams: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of input parameters for the project (e.g., {"date": "2024-01-01"})',
    },
    dryRun: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, perform a dry run without executing the project',
    },
    updateCache: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: '(Deprecated) If true, update the cached results after execution',
    },
    updatePublishedResults: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, update the published app results after execution',
    },
    useCachedSqlResults: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, use cached SQL results instead of re-running queries',
    },
  },

  request: {
    url: (params) => `https://app.hex.tech/api/v1/projects/${params.projectId}/runs`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.inputParams) {
        body.inputParams =
          typeof params.inputParams === 'string'
            ? JSON.parse(params.inputParams)
            : params.inputParams
      }
      if (params.dryRun !== undefined) body.dryRun = params.dryRun
      if (params.updateCache !== undefined) body.updateCache = params.updateCache
      if (params.updatePublishedResults !== undefined)
        body.updatePublishedResults = params.updatePublishedResults
      if (params.useCachedSqlResults !== undefined)
        body.useCachedSqlResults = params.useCachedSqlResults

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        projectId: data.projectId ?? null,
        runId: data.runId ?? null,
        runUrl: data.runUrl ?? null,
        runStatusUrl: data.runStatusUrl ?? null,
        traceId: data.traceId ?? null,
        projectVersion: data.projectVersion ?? null,
      },
    }
  },

  outputs: {
    projectId: HEX_RUN_OUTPUT_PROPERTIES.projectId,
    runId: HEX_RUN_OUTPUT_PROPERTIES.runId,
    runUrl: HEX_RUN_OUTPUT_PROPERTIES.runUrl,
    runStatusUrl: HEX_RUN_OUTPUT_PROPERTIES.runStatusUrl,
    traceId: HEX_RUN_OUTPUT_PROPERTIES.traceId,
    projectVersion: HEX_RUN_OUTPUT_PROPERTIES.projectVersion,
  },
}
