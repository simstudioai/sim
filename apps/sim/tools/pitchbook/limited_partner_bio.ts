import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookLimitedPartnerBioTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> =
  {
    id: 'pitchbook_limited_partner_bio',
    name: 'PitchBook Limited Partner Bio',
    description:
      'Retrieve the profile of a limited partner: names, description, type, assets under management, and staff',
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
          'PitchBook limited partner ID, e.g. 58901-50. Use a limited partner search to resolve a name to an ID.',
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
      url: (params) => `${PITCHBOOK_API_BASE}/limited-partners/${params.pbId.trim()}/bio`,
      method: 'GET',
      headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
    },

    transformResponse: async (response: Response) => {
      await throwIfNotOk(response, 'Failed to fetch limited partner bio')
      const data = await response.json()

      return {
        success: true,
        output: {
          limitedPartnerId: data.limitedPartnerId ?? null,
          limitedPartnerName: data.limitedPartnerName ?? null,
          description: data.description ?? null,
          assetsUnderManagement: data.assetsUnderManagement ?? null,
          yearFounded: data.yearFounded ?? null,
          website: data.website ?? null,
          managementStaff: data.managementStaff ?? null,
          limitedPartnerTypes: data.limitedPartnerTypes ?? [],
        },
      }
    },

    outputs: {
      limitedPartnerId: { type: 'string', description: 'PitchBook limited partner ID' },
      limitedPartnerName: {
        type: 'object',
        description: 'The names the limited partner is known by',
        properties: {
          formalName: { type: 'string', description: 'Formal name', nullable: true },
          alsoKnownAs: { type: 'string', description: 'Also-known-as name', nullable: true },
          legalName: { type: 'string', description: 'Registered legal name', nullable: true },
          formerlyKnownAs: { type: 'string', description: 'Previous name', nullable: true },
        },
      },
      description: {
        type: 'string',
        description: 'Description of the limited partner',
        nullable: true,
      },
      limitedPartnerTypes: {
        type: 'array',
        description: 'Types the limited partner is classified as, one flagged primary',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'object',
              description: 'Limited partner type',
              properties: {
                code: { type: 'string', description: 'Type code' },
                description: { type: 'string', description: 'Type label' },
              },
            },
            primary: { type: 'boolean', description: 'Whether this is the primary type' },
          },
        },
      },
      assetsUnderManagement: {
        type: 'object',
        description: 'Assets under management',
        nullable: true,
        properties: {
          amount: {
            type: 'number',
            description: 'Value in the requested currency',
            nullable: true,
          },
          currency: { type: 'string', description: 'Currency of amount', nullable: true },
          nativeAmount: {
            type: 'number',
            description: 'Value in the currency it was originally reported in',
            nullable: true,
          },
          nativeCurrency: {
            type: 'string',
            description: 'Currency of nativeAmount',
            nullable: true,
          },
          estimated: { type: 'boolean', description: 'Whether the value is a PitchBook estimate' },
        },
      },
      yearFounded: {
        type: 'number',
        description: 'Year the limited partner was founded',
        nullable: true,
      },
      website: { type: 'string', description: 'Limited partner website', nullable: true },
      managementStaff: {
        type: 'number',
        description: 'Number of management staff',
        nullable: true,
      },
    },
  }
