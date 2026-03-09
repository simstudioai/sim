import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioAssertRecordParams, AttioAssertRecordResponse } from './types'
import { RECORD_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioAssertRecord')

export const attioAssertRecordTool: ToolConfig<AttioAssertRecordParams, AttioAssertRecordResponse> =
  {
    id: 'attio_assert_record',
    name: 'Attio Assert Record',
    description:
      'Upsert a record in Attio — creates it if no match is found, updates it if a match exists',
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
      matchingAttribute: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'The attribute slug to match on for upsert (e.g. email_addresses for people, domains for companies)',
      },
      values: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'JSON object of attribute values (e.g. {"email_addresses":[{"email_address":"test@example.com"}]})',
      },
    },

    request: {
      url: (params) =>
        `https://api.attio.com/v2/objects/${params.objectType}/records?matching_attribute=${params.matchingAttribute}`,
      method: 'PUT',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        let values: Record<string, unknown> = {}
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
        throw new Error(data.message || 'Failed to assert record')
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
      record: {
        type: 'object',
        description: 'The upserted record',
        properties: RECORD_OUTPUT_PROPERTIES,
      },
      recordId: { type: 'string', description: 'The record ID' },
      webUrl: { type: 'string', description: 'URL to view the record in Attio' },
    },
  }
