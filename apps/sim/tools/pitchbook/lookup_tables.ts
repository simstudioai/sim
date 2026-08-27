import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookLookupTablesParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookLookupTablesTool: ToolConfig<PitchbookLookupTablesParams, PitchbookResponse> =
  {
    id: 'pitchbook_lookup_tables',
    name: 'PitchBook Lookup Tables',
    description:
      'Retrieve the codes in one or more lookup tables. These are the codes the search filters expect, such as INDUSTRY or VERTICAL.',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PitchBook API key',
      },
      tableNames: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Lookup tables to return, e.g. INDUSTRY or VERTICAL. Separate multiple names with a comma. Use the lookup table structure operation to see what is available.',
      },
      currency: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
      },
    },

    request: {
      url: (params) => {
        const qs = new URLSearchParams()
        qs.set('tableNames', params.tableNames.trim())
        const query = qs.toString()
        return `${PITCHBOOK_API_BASE}/lookup-tables${query ? `?${query}` : ''}`
      },
      method: 'GET',
      headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
    },

    transformResponse: async (response: Response) => {
      await throwIfNotOk(response, 'Failed to fetch lookup tables')
      const data = await response.json()

      return {
        success: true,
        output: {
          items: data.items ?? [],
        },
      }
    },

    outputs: {
      items: {
        type: 'array',
        description: 'Records returned',
        items: {
          type: 'object',
          properties: {
            tableName: { type: 'string', description: 'Lookup table name' },
            tableDescription: { type: 'string', description: 'What the lookup table contains' },
            codes: {
              type: 'array',
              description: 'Codes in the lookup table',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string', description: 'PitchBook code' },
                  description: { type: 'string', description: 'Human-readable label for the code' },
                },
              },
            },
          },
        },
      },
    },
  }
