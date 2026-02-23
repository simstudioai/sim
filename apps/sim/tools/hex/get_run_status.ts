import type { HexGetRunStatusParams, HexGetRunStatusResponse } from '@/tools/hex/types'
import { HEX_RUN_STATUS_OUTPUT_PROPERTIES } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const getRunStatusTool: ToolConfig<HexGetRunStatusParams, HexGetRunStatusResponse> = {
  id: 'hex_get_run_status',
  name: 'Hex Get Run Status',
  description: 'Check the status of a Hex project run by its run ID.',
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
      description: 'The UUID of the Hex project',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the run to check',
    },
  },

  request: {
    url: (params) =>
      `https://app.hex.tech/api/v1/projects/${params.projectId}/runs/${params.runId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        projectId: data.projectId ?? null,
        runId: data.runId ?? null,
        runUrl: data.runUrl ?? null,
        status: data.status ?? null,
        startTime: data.startTime ?? null,
        endTime: data.endTime ?? null,
        elapsedTime: data.elapsedTime ?? null,
        traceId: data.traceId ?? null,
        projectVersion: data.projectVersion ?? null,
      },
    }
  },

  outputs: {
    projectId: HEX_RUN_STATUS_OUTPUT_PROPERTIES.projectId,
    runId: HEX_RUN_STATUS_OUTPUT_PROPERTIES.runId,
    runUrl: HEX_RUN_STATUS_OUTPUT_PROPERTIES.runUrl,
    status: HEX_RUN_STATUS_OUTPUT_PROPERTIES.status,
    startTime: HEX_RUN_STATUS_OUTPUT_PROPERTIES.startTime,
    endTime: HEX_RUN_STATUS_OUTPUT_PROPERTIES.endTime,
    elapsedTime: HEX_RUN_STATUS_OUTPUT_PROPERTIES.elapsedTime,
    traceId: HEX_RUN_STATUS_OUTPUT_PROPERTIES.traceId,
    projectVersion: HEX_RUN_STATUS_OUTPUT_PROPERTIES.projectVersion,
  },
}
