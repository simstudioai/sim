import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookPersonContactTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_person_contact',
  name: 'PitchBook Person Contact',
  description: 'Retrieve the direct contact details on file for a person',
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
        'PitchBook person ID, e.g. 53503-66P. Person IDs end in P and come from a people search.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/people/${params.pbId.trim()}/contact`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch person contact')
    const data = await response.json()

    return {
      success: true,
      output: {
        personId: data.personId ?? null,
        fullName: data.fullName ?? null,
        phone: data.phone ?? null,
        fax: data.fax ?? null,
        email: data.email ?? null,
      },
    }
  },

  outputs: {
    personId: { type: 'string', description: 'PitchBook person ID', nullable: true },
    fullName: { type: 'string', description: 'Full name of the person', nullable: true },
    phone: { type: 'string', description: 'Phone number', nullable: true },
    fax: { type: 'string', description: 'Fax number', nullable: true },
    email: { type: 'string', description: 'Email address', nullable: true },
  },
}
