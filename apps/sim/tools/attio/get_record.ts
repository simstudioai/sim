import { createLogger } from '@sim/logger'
import type { AttioGetRecordParams, AttioGetRecordResponse } from '@/tools/attio/types'
import { RECORD_OBJECT_OUTPUT } from '@/tools/attio/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('AttioGetRecord')

export const attioGetRecordTool: ToolConfig<AttioGetRecordParams, AttioGetRecordResponse> = {
  id: 'attio_get_record',
  name: 'Get Record from Attio',
  description: 'Get a specific record from an Attio object by its record ID.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'attio',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Attio API',
    },
    object: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The object type (e.g., "people", "companies", or a custom object slug)',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique record ID to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://api.attio.com/v2/objects/${encodeURIComponent(params.object)}/records/${encodeURIComponent(params.recordId)}`,
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || data.error || 'Failed to get record from Attio')
    }

    const record = data.data

    return {
      success: true,
      output: {
        record,
        recordId: record?.id?.record_id || '',
        success: true,
      },
    }
  },

  outputs: {
    record: RECORD_OBJECT_OUTPUT,
    recordId: { type: 'string', description: 'The record ID' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
