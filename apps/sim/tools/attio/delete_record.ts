import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioDeleteRecordParams, AttioDeleteRecordResponse } from './types'

const logger = createLogger('AttioDeleteRecord')

export const attioDeleteRecordTool: ToolConfig<AttioDeleteRecordParams, AttioDeleteRecordResponse> =
  {
    id: 'attio_delete_record',
    name: 'Attio Delete Record',
    description: 'Delete a record from Attio',
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
        description: 'The ID of the record to delete',
      },
    },

    request: {
      url: (params) =>
        `https://api.attio.com/v2/objects/${params.objectType}/records/${params.recordId}`,
      method: 'DELETE',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response) => {
      if (!response.ok) {
        const data = await response.json()
        logger.error('Attio API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to delete record')
      }
      return {
        success: true,
        output: {
          deleted: true,
        },
      }
    },

    outputs: {
      deleted: { type: 'boolean', description: 'Whether the record was deleted' },
    },
  }
