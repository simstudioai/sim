import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookPersonBioTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_person_bio',
  name: 'PitchBook Person Bio',
  description:
    'Retrieve the profile of a person: name, biography, LinkedIn, primary employer, position, and office',
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
    url: (params) => `${PITCHBOOK_API_BASE}/people/${params.pbId.trim()}/bio`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch person bio')
    const data = await response.json()

    return {
      success: true,
      output: {
        personId: data.personId ?? null,
        personName: data.personName ?? null,
        biography: data.biography ?? null,
        linkedInProfileUrl: data.linkedInProfileUrl ?? null,
        gender: data.gender ?? null,
        primaryEntityId: data.primaryEntityId ?? null,
        primaryEntityName: data.primaryEntityName ?? null,
        primaryEntityType: data.primaryEntityType ?? null,
        primaryEntityWebsite: data.primaryEntityWebsite ?? null,
        primaryPosition: data.primaryPosition ?? null,
        primaryOffice: data.primaryOffice ?? null,
      },
    }
  },

  outputs: {
    personId: { type: 'string', description: 'PitchBook person ID', nullable: true },
    personName: {
      type: 'object',
      description: 'Parsed name of the person',
      properties: {
        full: { type: 'string', description: 'Full name', nullable: true },
        first: { type: 'string', description: 'First name', nullable: true },
        last: { type: 'string', description: 'Last name', nullable: true },
        middle: { type: 'string', description: 'Middle name', nullable: true },
        prefix: { type: 'string', description: 'Name prefix', nullable: true },
        suffix: { type: 'string', description: 'Name suffix', nullable: true },
      },
    },
    biography: { type: 'string', description: 'Biography of the person', nullable: true },
    linkedInProfileUrl: { type: 'string', description: 'LinkedIn profile URL', nullable: true },
    gender: { type: 'string', description: 'Gender recorded for the person', nullable: true },
    primaryEntityId: {
      type: 'string',
      description: 'PitchBook ID of the primary employer',
      nullable: true,
    },
    primaryEntityName: {
      type: 'string',
      description: 'Name of the primary employer',
      nullable: true,
    },
    primaryEntityType: {
      type: 'string',
      description: 'Type of the primary employer, such as COMPANY or INVESTOR',
      nullable: true,
    },
    primaryEntityWebsite: {
      type: 'string',
      description: 'Website of the primary employer',
      nullable: true,
    },
    primaryPosition: {
      type: 'string',
      description: 'Position the person holds at the primary employer',
      nullable: true,
    },
    primaryOffice: {
      type: 'object',
      description: 'Office the person works out of',
      nullable: true,
      properties: {
        location: { type: 'string', description: 'Office label', nullable: true },
        addressLine1: { type: 'string', description: 'Address line 1', nullable: true },
        addressLine2: { type: 'string', description: 'Address line 2', nullable: true },
        city: { type: 'string', description: 'City', nullable: true },
        stateProvince: { type: 'string', description: 'State or province', nullable: true },
        postCode: { type: 'string', description: 'Postal code', nullable: true },
        country: { type: 'string', description: 'Country', nullable: true },
        phone: { type: 'string', description: 'Phone number', nullable: true },
        fax: { type: 'string', description: 'Fax number', nullable: true },
        email: { type: 'string', description: 'Email address', nullable: true },
        globalRegion: { type: 'string', description: 'Global region', nullable: true },
        globalSubRegion: { type: 'string', description: 'Global sub-region', nullable: true },
      },
    },
  },
}
