import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioCreateRecordParams, AttioCreateRecordResponse } from './types'
import { RECORD_OBJECT_OUTPUT } from './types'

const logger = createLogger('AttioCreateRecord')

export const attioCreateRecordTool: ToolConfig<AttioCreateRecordParams, AttioCreateRecordResponse> =
  {
    id: 'attio_create_record',
    name: 'Attio Create Record',
    description: 'Create a new record in Attio for a given object type',
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
      values: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'JSON object of attribute values to set on the record',
      },
    },

    request: {
      url: (params) => `https://api.attio.com/v2/objects/${params.objectType}/records`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        let values: Record<string, unknown>
        try {
          values = typeof params.values === 'string' ? JSON.parse(params.values) : params.values
        } catch {
          values = {}
        }
        return { data: { values } }
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!response.ok) {
        logger.error('Attio API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to create record')
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
      recordId: { type: 'string', description: 'The ID of the created record' },
      webUrl: { type: 'string', description: 'URL to view the record in Attio' },
    },
  }
