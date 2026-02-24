import { createLogger } from '@sim/logger'
import type { AttioCreateRecordParams, AttioCreateRecordResponse } from '@/tools/attio/types'
import { RECORD_OBJECT_OUTPUT } from '@/tools/attio/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('AttioCreateRecord')

export const attioCreateRecordTool: ToolConfig<AttioCreateRecordParams, AttioCreateRecordResponse> =
  {
    id: 'attio_create_record',
    name: 'Create Record in Attio',
    description:
      'Create a new record in an Attio object (people, companies, or custom objects). Values should be provided as attribute slug to value mappings.',
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
        description:
          'The object type to create a record in (e.g., "people", "companies", or a custom object slug)',
      },
      values: {
        type: 'object',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Record values as JSON object with attribute slugs as keys (e.g., {"name": "John Doe", "email_addresses": "john@example.com"})',
      },
    },

    request: {
      url: (params) =>
        `https://api.attio.com/v2/objects/${encodeURIComponent(params.object)}/records`,
      method: 'POST',
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
        throw new Error(data.message || data.error || 'Failed to create record in Attio')
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
      recordId: { type: 'string', description: 'The created record ID' },
      success: { type: 'boolean', description: 'Operation success status' },
    },
  }
