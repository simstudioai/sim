import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioGetRecordParams, AttioGetRecordResponse } from './types'
import { RECORD_OBJECT_OUTPUT } from './types'

const logger = createLogger('AttioGetRecord')

export const attioGetRecordTool: ToolConfig<AttioGetRecordParams, AttioGetRecordResponse> = {
  id: 'attio_get_record',
  name: 'Attio Get Record',
  description: 'Get a single record by ID from Attio',
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
      description: 'The OAuth access token for the Attio API',
    },
    objectType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The object type slug (e.g. people, companies)',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the record to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://api.attio.com/v2/objects/${params.objectType}/records/${params.recordId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get record')
    }
    const record = data.data
    return {
      success: true,
      output: {
        record,
        recordId: record.id?.record_id ?? null,
        webUrl: record.web_url ?? null,
      },
    }
  },

  outputs: {
    record: RECORD_OBJECT_OUTPUT,
    recordId: { type: 'string', description: 'The record ID' },
    webUrl: { type: 'string', description: 'URL to view the record in Attio' },
  },
}
