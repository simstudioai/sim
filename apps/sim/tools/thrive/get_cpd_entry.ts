import type { ThriveCpdEntryResponse, ThriveGetCpdEntryParams } from '@/tools/thrive/types'
import { THRIVE_CPD_ENTRY_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getCpdEntryTool: ToolConfig<ThriveGetCpdEntryParams, ThriveCpdEntryResponse> = {
  id: 'thrive_get_cpd_entry',
  name: 'Thrive Get CPD Entry',
  description: 'Get a single CPD log entry in Thrive by its ID.',
  version: '1.0.0',

  params: {
    tenantId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive Tenant ID (used as the Basic auth username)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive API key (used as the Basic auth password)',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Region-specific API host',
    },
    logEntryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The CPD log entry ID',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/cpdEntries/${encodeURIComponent(params.logEntryId)}`,
    method: 'GET',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
  },

  transformResponse: async (response: Response): Promise<ThriveCpdEntryResponse> => {
    const data = await parseThriveResponse(response, 'Failed to get CPD entry')
    return { success: true, output: { entry: data ?? null } }
  },

  outputs: {
    entry: {
      type: 'object',
      description: 'The CPD entry',
      properties: THRIVE_CPD_ENTRY_OUTPUT_PROPERTIES,
    },
  },
}
