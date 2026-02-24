import { createLogger } from '@sim/logger'
import type { AttioUpdateRecordParams, AttioUpdateRecordResponse } from '@/tools/attio/types'
import { RECORD_OBJECT_OUTPUT } from '@/tools/attio/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('AttioUpdateRecord')

export const attioUpdateRecordTool: ToolConfig<AttioUpdateRecordParams, AttioUpdateRecordResponse> =
  {
    id: 'attio_update_record',
    name: 'Update Record in Attio',
    description:
      'Update an existing record in an Attio object. Values should be provided as attribute slug to value mappings.',
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
        description: 'The unique record ID to update',
      },
      values: {
        type: 'object',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Record values to update as JSON object with attribute slugs as keys (e.g., {"name": "Jane Doe", "phone_numbers": "+1234567890"})',
      },
    },

    request: {
      url: (params) =>
        `https://api.attio.com/v2/objects/${encodeURIComponent(params.object)}/records/${encodeURIComponent(params.recordId)}`,
      method: 'PATCH',
      headers: (params) => {
        if (!params.accessToken) {
          throw new Error('Access token is required')
        }

        return {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        }
      },
      body: (params) => {
        let values = params.values
        if (typeof values === 'string') {
          try {
            values = JSON.parse(values)
          } catch {
            throw new Error('Invalid JSON format for values. Please provide a valid JSON object.')
          }
        }

        return {
          data: {
            values,
          },
        }
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        logger.error('Attio API request failed', { data, status: response.status })
        throw new Error(data.message || data.error || 'Failed to update record in Attio')
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
      recordId: { type: 'string', description: 'The updated record ID' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
