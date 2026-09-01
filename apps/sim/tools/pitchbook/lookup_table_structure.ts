import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookBaseParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookLookupTableStructureTool: ToolConfig<PitchbookBaseParams, PitchbookResponse> =
  {
    id: 'pitchbook_lookup_table_structure',
    name: 'PitchBook Lookup Table Structure',
    description:
      'List the lookup tables backing the search endpoints. Use this to find which table holds the codes a search filter expects.',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PitchBook API key',
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
      url: (params) => `${PITCHBOOK_API_BASE}/lookup-tables/structure`,
      method: 'GET',
      headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
    },

    transformResponse: async (response: Response) => {
      await throwIfNotOk(response, 'Failed to fetch lookup table structure')
      const data = await response.json()

      return {
        success: true,
        output: {
          tables: Array.isArray(data) ? data : [],
        },
      }
    },

    outputs: {
      tables: {
        type: 'array',
        description: 'Lookup tables available',
        items: {
          type: 'object',
          properties: {
            tableName: { type: 'string', description: 'Lookup table name' },
            tableDescription: { type: 'string', description: 'What the lookup table contains' },
          },
        },
      },
    },
  }
