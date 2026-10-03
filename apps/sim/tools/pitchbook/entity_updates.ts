import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookResponse, PitchbookUpdatesParams } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookEntityUpdatesTool: ToolConfig<PitchbookUpdatesParams, PitchbookResponse> = {
  id: 'pitchbook_entity_updates',
  name: 'PitchBook Entity Updates',
  description:
    'Check which entity datasets changed in a window, so a sync only refetches what moved',
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
    sinceDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Window to report changes over, carrying its operator in the value: >YYYY-MM-DD for after a date, <YYYY-MM-DD for before one, or YYYY-MM-DD^YYYY-MM-DD for a range. Use this or trailingRange.',
    },
    trailingRange: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Report changes over the last N days. Use this or sinceDate.',
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
      if (params.sinceDate) qs.set('sinceDate', params.sinceDate)
      if (params.trailingRange !== undefined && params.trailingRange !== null) {
        qs.set('trailingRange', String(params.trailingRange))
      }
      const query = qs.toString()
      return `${PITCHBOOK_API_BASE}/entities/${params.pbId.trim()}/updates${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch updates')
    const data = await response.json()

    return {
      success: true,
      output: {
        updates: data.updates ?? null,
      },
    }
  },

  outputs: {
    updates: {
      type: 'json',
      description:
        'Map of dataset name to whether it changed in the window. Keys are PitchBook dataset names, so read it as a plain object.',
      nullable: true,
    },
  },
}
