import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioUpdateRecordParams, AttioUpdateRecordResponse } from './types'
import { RECORD_OBJECT_OUTPUT } from './types'

const logger = createLogger('AttioUpdateRecord')

export const attioUpdateRecordTool: ToolConfig<AttioUpdateRecordParams, AttioUpdateRecordResponse> =
  {
    id: 'attio_update_record',
    name: 'Attio Update Record',
    description: 'Update an existing record in Attio (appends multiselect values)',
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
        description: 'The ID of the record to update',
      },
      values: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'JSON object of attribute values to update',
      },
    },

    request: {
      url: (params) =>
        `https://api.attio.com/v2/objects/${params.objectType}/records/${params.recordId}`,
      method: 'PATCH',
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
        throw new Error(data.message || 'Failed to update record')
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
      recordId: { type: 'string', description: 'The ID of the updated record' },
      webUrl: { type: 'string', description: 'URL to view the record in Attio' },
    },
  }
