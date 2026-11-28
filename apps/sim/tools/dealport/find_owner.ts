import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import { DEALPORT_ACCESS_TOKEN_PARAM, DEALPORT_OAUTH } from '@/tools/dealport/params'
import {
  DEALPORT_OWNER_EMAIL_OUTPUT_PROPERTIES,
  DEALPORT_OWNER_PERSON_OUTPUT_PROPERTIES,
  DEALPORT_OWNER_PHONE_OUTPUT_PROPERTIES,
  DEALPORT_OWNER_PROFILE_OUTPUT_PROPERTIES,
  type DealportFindOwnerParams,
  type DealportFindOwnerResponse,
} from '@/tools/dealport/types'
import {
  buildFindOwnerBody,
  DEALPORT_API_BASE,
  dealportJsonHeaders,
  mapOwnerEmail,
  mapOwnerPerson,
  mapOwnerPhone,
  mapOwnerProfile,
} from '@/tools/dealport/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const dealportFindOwnerTool: ToolConfig<DealportFindOwnerParams, DealportFindOwnerResponse> =
  {
    id: 'dealport_find_owner',
    name: 'Dealport Find Owner',
    description:
      'Resolve the verified human principal behind a private company, US LLC, or property address with direct phones, emails, and professional profile.',
    version: '1.0.0',
    effect: 'write',
    oauth: DEALPORT_OAUTH,
    errorExtractor: ErrorExtractorId.STANDARD_MESSAGE,

    params: {
      ...DEALPORT_ACCESS_TOKEN_PARAM,
      company_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Dealport company UUID. Provide at least one of company_id, llc_name, or property_address.',
      },
      llc_name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'US LLC or holding entity name when company_id is omitted',
      },
      property_address: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'US street address to resolve the human property principal',
      },
      state: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Two-letter US state code for LLC or property resolution',
      },
      city: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'City of the entity or property',
      },
      mailing_address: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Tax or corporate filing mailing address',
      },
      care_of: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Care-of line from a deed or tax roll',
      },
      person: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Full name of a specific principal on the company Record',
      },
    },

    request: {
      url: `${DEALPORT_API_BASE}/owners`,
      method: 'POST',
      headers: (params) => dealportJsonHeaders(params.accessToken),
      body: (params) => buildFindOwnerBody(params),
    },

    transformResponse: async (response) => {
      const payload = toRecord(await response.json())
      const company = toRecord(payload.company)
      const sources = toArray(payload.sources).map((entry) => {
        const source = toRecord(entry)
        return {
          url: toStringOrNull(source.url) ?? '',
          title: toStringOrNull(source.title) ?? '',
        }
      })
      return {
        success: true,
        output: {
          company: {
            id: toStringOrNull(company.id) ?? '',
            name: toStringOrNull(company.name) ?? '',
          },
          person: mapOwnerPerson(payload.person),
          phone: toStringOrNull(payload.phone),
          email: toStringOrNull(payload.email),
          phones: toArray(payload.phones).map(mapOwnerPhone),
          emails: toArray(payload.emails).map(mapOwnerEmail),
          profile: mapOwnerProfile(payload.profile),
          sources,
          record_url: toStringOrNull(payload.record_url) ?? '',
          note: toStringOrNull(payload.note),
          cost_usd: toNumberOrNull(payload.cost_usd) ?? 0,
          remaining_balance_usd: toNumberOrNull(payload.remaining_balance_usd) ?? 0,
        },
      }
    },

    outputs: {
      company: {
        type: 'object',
        description: 'Resolved company or entity identifier',
        properties: {
          id: { type: 'string', description: 'Dealport company UUID' },
          name: { type: 'string', description: 'Company or entity name' },
        },
      },
      person: {
        type: 'object',
        nullable: true,
        description: 'Resolved human principal, or null when no verified principal was found',
        properties: DEALPORT_OWNER_PERSON_OUTPUT_PROPERTIES,
      },
      phone: {
        type: 'string',
        nullable: true,
        description: 'Primary verified direct or mobile phone number',
      },
      email: {
        type: 'string',
        nullable: true,
        description: 'Primary verified work or personal email address',
      },
      phones: {
        type: 'array',
        description: 'All verified direct and mobile phone numbers for the principal',
        items: {
          type: 'object',
          properties: DEALPORT_OWNER_PHONE_OUTPUT_PROPERTIES,
        },
      },
      emails: {
        type: 'array',
        description: 'All verified work and personal email addresses for the principal',
        items: {
          type: 'object',
          properties: DEALPORT_OWNER_EMAIL_OUTPUT_PROPERTIES,
        },
      },
      profile: {
        type: 'object',
        nullable: true,
        description:
          'Professional profile including LinkedIn URL, career roles, education, and skills',
        properties: DEALPORT_OWNER_PROFILE_OUTPUT_PROPERTIES,
      },
      sources: {
        type: 'array',
        description: 'Primary filing and verification sources for the owner resolution',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Source URL' },
            title: { type: 'string', description: 'Source title' },
          },
        },
      },
      record_url: {
        type: 'string',
        description: 'Dealport Record URL for the company or entity',
      },
      note: {
        type: 'string',
        nullable: true,
        optional: true,
        description: 'Resolution diagnostic note when provided by Dealport',
      },
      cost_usd: {
        type: 'number',
        description:
          'USD charge for this lookup ($0.09 on a verified phone or email hit; $0.00 on miss or 30-day repeat)',
      },
      remaining_balance_usd: {
        type: 'number',
        description: 'Remaining workspace USD balance after the call',
      },
    },
  }
