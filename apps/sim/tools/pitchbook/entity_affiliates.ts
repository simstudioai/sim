import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookEntityAffiliatesTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> =
  {
    id: 'pitchbook_entity_affiliates',
    name: 'PitchBook Entity Affiliates',
    description: 'Retrieve the affiliated entities linked to an entity and how each is related',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PitchBook API key',
      },
      pbId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'PitchBook entity ID of a company, investor, or service provider, e.g. 51261-67.',
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
      url: (params) => `${PITCHBOOK_API_BASE}/entities/${params.pbId.trim()}/affiliates`,
      method: 'GET',
      headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
    },

    transformResponse: async (response: Response) => {
      await throwIfNotOk(response, 'Failed to fetch entity affiliates')
      const data = await response.json()

      return {
        success: true,
        output: {
          affiliates: Array.isArray(data) ? data : [],
        },
      }
    },

    outputs: {
      affiliates: {
        type: 'array',
        description: 'Entities affiliated with the given entity',
        items: {
          type: 'object',
          properties: {
            entityId: { type: 'string', description: 'PitchBook entity ID' },
            affiliateId: { type: 'string', description: 'PitchBook ID of the affiliate' },
            affiliateName: { type: 'string', description: 'Name of the affiliate' },
            affiliateType: { type: 'string', description: 'Relationship to the affiliate' },
          },
        },
      },
    },
  }
