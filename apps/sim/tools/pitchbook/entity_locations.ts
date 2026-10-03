import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookEntityLocationsTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_entity_locations',
  name: 'PitchBook Entity Locations',
  description: 'Retrieve the headquarters and every alternate office on record for an entity',
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
    url: (params) => `${PITCHBOOK_API_BASE}/entities/${params.pbId.trim()}/locations`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch entity locations')
    const data = await response.json()

    return {
      success: true,
      output: {
        entityId: data.entityId ?? null,
        hqOffice: data.hqOffice ?? null,
        alternateOffices: data.alternateOffices ?? [],
        alternateOfficesCount: data.alternateOfficesCount ?? null,
      },
    }
  },

  outputs: {
    entityId: { type: 'string', description: 'PitchBook entity ID', nullable: true },
    hqOffice: {
      type: 'object',
      description: 'Headquarters office',
      properties: {
        location: { type: 'string', description: 'Office label' },
        addressLine1: { type: 'string', description: 'Address line 1' },
        addressLine2: { type: 'json', description: 'Address line 2', nullable: true },
        city: { type: 'string', description: 'City' },
        stateProvince: { type: 'string', description: 'State or province' },
        postCode: { type: 'string', description: 'Postal code' },
        country: { type: 'string', description: 'Country' },
        phone: { type: 'string', description: 'Phone number' },
        fax: { type: 'json', description: 'Fax number', nullable: true },
        email: { type: 'string', description: 'Email address' },
        globalRegion: { type: 'string', description: 'Global region' },
        globalSubRegion: { type: 'string', description: 'Global sub-region' },
      },
    },
    alternateOffices: {
      type: 'array',
      description: 'Other offices on record',
      items: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Office label' },
          addressLine1: { type: 'string', description: 'Address line 1', nullable: true },
          addressLine2: { type: 'string', description: 'Address line 2', nullable: true },
          city: { type: 'string', description: 'City', nullable: true },
          stateProvince: { type: 'string', description: 'State or province', nullable: true },
          postCode: { type: 'string', description: 'Postal code', nullable: true },
          country: { type: 'string', description: 'Country' },
          phone: { type: 'json', description: 'Phone number', nullable: true },
          fax: { type: 'json', description: 'Fax number', nullable: true },
          email: { type: 'string', description: 'Email address' },
          globalRegion: { type: 'string', description: 'Global region' },
          globalSubRegion: { type: 'string', description: 'Global sub-region' },
        },
      },
    },
    alternateOfficesCount: {
      type: 'number',
      description: 'How many other offices are on record',
      nullable: true,
    },
  },
}
