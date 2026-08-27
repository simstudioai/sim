import { z } from 'zod'
import { foragerPost, parseForagerFilters, parseForagerInteger } from '@/tools/forager/client'
import { fixedForagerCredits, successfulArrayForagerCredits } from '@/tools/forager/hosting'
import {
  EMAILS_OUTPUT,
  FORAGER_AUTH_PARAMS,
  FORAGER_SEARCH_PARAMS,
  PERSON_OUTPUT,
  PHONE_NUMBERS_OUTPUT,
  TOTAL_SEARCH_RESULTS_OUTPUT,
  WEBSITE_OUTPUT,
} from '@/tools/forager/outputs'
import {
  type ForagerResponseSchema,
  personDetailSchema,
  personEmailDetailsSchema,
  personInfoRequestSchema,
  personPhoneDetailsSchema,
  personWorkEmailsRequestSchema,
  websiteLookupRequestSchema,
  websiteSchema,
} from '@/tools/forager/schemas'
import type {
  ForagerEmailLookupResponse,
  ForagerPersonLookupParams,
  ForagerPersonLookupResponse,
  ForagerPhoneLookupResponse,
  ForagerRecord,
  ForagerReverseEmailLookupParams,
  ForagerReversePhoneLookupParams,
  ForagerSearchParams,
  ForagerSearchResponse,
  ForagerTotalsResponse,
  ForagerWebsiteLookupParams,
  ForagerWebsiteLookupResponse,
  ForagerWorkEmailLookupParams,
} from '@/tools/forager/types'
import type { OutputProperty, ToolConfig } from '@/tools/types'

const DIRECT_REQUEST = {
  url: 'https://api-v2.forager.ai',
  method: 'POST' as const,
  headers: () => ({ Accept: 'application/json' }),
}

interface SearchApiResponse {
  search_results: ForagerRecord[]
  total_search_results: number
}

interface TotalsApiResponse {
  total_search_results: number
  total_persons?: number
  total_organizations?: number
}

interface SearchToolOptions {
  id: string
  name: string
  description: string
  path: string
  credits: number
  pricingBasis: string
  requestSchema: ForagerResponseSchema<Record<string, unknown>>
  responseSchema: ForagerResponseSchema<SearchApiResponse>
  resultsOutput: OutputProperty
}

interface TotalsToolOptions {
  id: string
  name: string
  description: string
  path: string
  credits: number
  pricingBasis: string
  requestSchema: ForagerResponseSchema<Record<string, unknown>>
  responseSchema: ForagerResponseSchema<TotalsApiResponse>
  includeRoleTotals?: boolean
}

export function createForagerSearchTool(
  options: SearchToolOptions
): ToolConfig<ForagerSearchParams, ForagerSearchResponse> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    hosting: fixedForagerCredits(options.credits, options.pricingBasis),
    params: FORAGER_SEARCH_PARAMS,
    request: DIRECT_REQUEST,
    directExecution: async (params, signal) => {
      const body = options.requestSchema.parse(parseForagerFilters(params.filters))
      const data = await foragerPost(params, options.path, body, options.responseSchema, { signal })
      return {
        success: true,
        output: {
          results: data.search_results.map((result) => ({ ...result })),
          totalSearchResults: data.total_search_results,
        },
      }
    },
    outputs: {
      results: options.resultsOutput,
      totalSearchResults: TOTAL_SEARCH_RESULTS_OUTPUT,
    },
  }
}

export function createForagerTotalsTool(
  options: TotalsToolOptions
): ToolConfig<ForagerSearchParams, ForagerTotalsResponse> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    hosting: fixedForagerCredits(options.credits, options.pricingBasis),
    params: FORAGER_SEARCH_PARAMS,
    request: DIRECT_REQUEST,
    directExecution: async (params, signal) => {
      const body = options.requestSchema.parse(parseForagerFilters(params.filters))
      const data = await foragerPost(params, options.path, body, options.responseSchema, { signal })
      return {
        success: true,
        output: {
          totalSearchResults: data.total_search_results,
          ...(options.includeRoleTotals
            ? {
                totalPersons: data.total_persons,
                totalOrganizations: data.total_organizations,
              }
            : {}),
        },
      }
    },
    outputs: {
      totalSearchResults: TOTAL_SEARCH_RESULTS_OUTPUT,
      ...(options.includeRoleTotals
        ? {
            totalPersons: {
              type: 'number' as const,
              description: 'Total distinct people matching the role search',
            },
            totalOrganizations: {
              type: 'number' as const,
              description: 'Total distinct organizations matching the role search',
            },
          }
        : {}),
    },
  }
}

interface ContactToolOptions {
  id: string
  name: string
  description: string
  path: string
  outputKey: 'emails' | 'phoneNumbers'
  credits: number
  pricingBasis: string
  includeContactsEnrichment?: boolean
  allowEmptyResponse?: boolean
  chargeOnlyWhenNonempty?: boolean
}

export function createForagerContactTool(
  options: ContactToolOptions
): ToolConfig<
  ForagerWorkEmailLookupParams,
  ForagerEmailLookupResponse | ForagerPhoneLookupResponse
> {
  const outputProperty = options.outputKey === 'emails' ? EMAILS_OUTPUT : PHONE_NUMBERS_OUTPUT
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    hosting: options.chargeOnlyWhenNonempty
      ? successfulArrayForagerCredits(options.outputKey, options.credits, options.pricingBasis)
      : fixedForagerCredits(options.credits, options.pricingBasis),
    params: {
      ...FORAGER_AUTH_PARAMS,
      personId: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Forager person ID; provide this or linkedinPublicIdentifier',
      },
      linkedinPublicIdentifier: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'LinkedIn public profile slug from linkedin.com/in/{slug}',
      },
      ...(options.includeContactsEnrichment
        ? {
            doContactsEnrichment: {
              type: 'boolean',
              required: false,
              visibility: 'user-or-llm' as const,
              description: 'Ask Forager to perform contact enrichment before returning work emails',
            },
          }
        : {}),
    },
    request: DIRECT_REQUEST,
    directExecution: async (params, signal) => {
      const body = personInfoBody(params, options.includeContactsEnrichment ?? false)
      if (options.outputKey === 'emails') {
        const data = await foragerPost(params, options.path, body, personEmailDetailsSchema, {
          allowEmptyArray: options.allowEmptyResponse ?? false,
          signal,
        })
        return {
          success: true,
          output: { emails: data.map((item) => ({ ...item })) },
        }
      }
      const data = await foragerPost(params, options.path, body, personPhoneDetailsSchema, {
        signal,
      })
      return {
        success: true,
        output: { phoneNumbers: data.map((item) => ({ ...item })) },
      }
    },
    outputs: { [options.outputKey]: outputProperty },
  }
}

function personInfoBody(
  params: ForagerWorkEmailLookupParams,
  includeContactsEnrichment: boolean
): Record<string, unknown> {
  const personId =
    params.personId === undefined || params.personId === null || params.personId === ''
      ? undefined
      : parseForagerInteger(params.personId, 'personId')
  const linkedinPublicIdentifier = params.linkedinPublicIdentifier?.trim() || undefined
  if (personId === undefined && !linkedinPublicIdentifier) {
    throw new Error('Forager person lookup requires personId or linkedinPublicIdentifier')
  }
  const request = {
    person_id: personId,
    linkedin_public_identifier: linkedinPublicIdentifier,
    ...(includeContactsEnrichment && params.doContactsEnrichment !== undefined
      ? {
          do_contacts_enrichment:
            params.doContactsEnrichment === true || params.doContactsEnrichment === 'true',
        }
      : {}),
  }
  return (
    includeContactsEnrichment ? personWorkEmailsRequestSchema : personInfoRequestSchema
  ).parse(request)
}

export function createForagerPersonDetailTool(options: {
  id: string
  name: string
  description: string
  path: string
  credits: number
  pricingBasis: string
}): ToolConfig<ForagerPersonLookupParams, ForagerPersonLookupResponse> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    hosting: fixedForagerCredits(options.credits, options.pricingBasis),
    params: {
      ...FORAGER_AUTH_PARAMS,
      personId: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Forager person ID; provide this or linkedinPublicIdentifier',
      },
      linkedinPublicIdentifier: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'LinkedIn public profile slug from linkedin.com/in/{slug}',
      },
    },
    request: DIRECT_REQUEST,
    directExecution: async (params, signal) => {
      const body = personInfoBody(params, false)
      const data = await foragerPost(params, options.path, body, personDetailSchema, { signal })
      return { success: true, output: { person: { ...data } } }
    },
    outputs: { person: PERSON_OUTPUT },
  }
}

export function createForagerReverseEmailTool(options: {
  id: string
  name: string
  description: string
  path: string
  credits: number
  pricingBasis: string
}): ToolConfig<ForagerReverseEmailLookupParams, ForagerPersonLookupResponse> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    hosting: fixedForagerCredits(options.credits, options.pricingBasis),
    params: {
      ...FORAGER_AUTH_PARAMS,
      email: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Personal email address to reverse lookup',
      },
    },
    request: DIRECT_REQUEST,
    directExecution: async (params, signal) => {
      const body = z.object({ email: z.string().email() }).strict().parse({ email: params.email })
      const data = await foragerPost(params, options.path, body, personDetailSchema, { signal })
      return { success: true, output: { person: { ...data } } }
    },
    outputs: { person: PERSON_OUTPUT },
  }
}

export function createForagerReversePhoneTool(options: {
  id: string
  name: string
  description: string
  path: string
  credits: number
  pricingBasis: string
}): ToolConfig<ForagerReversePhoneLookupParams, ForagerPersonLookupResponse> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    hosting: fixedForagerCredits(options.credits, options.pricingBasis),
    params: {
      ...FORAGER_AUTH_PARAMS,
      phoneNumber: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Phone number to reverse lookup',
      },
    },
    request: DIRECT_REQUEST,
    directExecution: async (params, signal) => {
      const body = z
        .object({ phone_number: z.string().min(1) })
        .strict()
        .parse({ phone_number: params.phoneNumber })
      const data = await foragerPost(params, options.path, body, personDetailSchema, { signal })
      return { success: true, output: { person: { ...data } } }
    },
    outputs: { person: PERSON_OUTPUT },
  }
}

export function createForagerWebsiteTool(options: {
  id: string
  name: string
  description: string
  path: string
  credits: number
  pricingBasis: string
}): ToolConfig<ForagerWebsiteLookupParams, ForagerWebsiteLookupResponse> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: '1.0.0',
    hosting: fixedForagerCredits(options.credits, options.pricingBasis),
    params: {
      ...FORAGER_AUTH_PARAMS,
      domain: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Website domain to look up',
      },
      organizationId: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Forager organization ID to look up',
      },
      organizationLinkedinPublicIdentifier: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'LinkedIn company slug from linkedin.com/company/{slug}',
      },
    },
    request: DIRECT_REQUEST,
    directExecution: async (params, signal) => {
      const domain = params.domain?.trim() || undefined
      const organizationId =
        params.organizationId === undefined ||
        params.organizationId === null ||
        params.organizationId === ''
          ? undefined
          : parseForagerInteger(params.organizationId, 'organizationId')
      const organizationLinkedinPublicIdentifier =
        params.organizationLinkedinPublicIdentifier?.trim() || undefined
      if (!domain && organizationId === undefined && !organizationLinkedinPublicIdentifier) {
        throw new Error(
          'Forager website lookup requires domain, organizationId, or organizationLinkedinPublicIdentifier'
        )
      }
      const body = websiteLookupRequestSchema.parse({
        domain,
        organization_id: organizationId,
        organization_linkedin_public_identifier: organizationLinkedinPublicIdentifier,
      })
      const data = await foragerPost(params, options.path, body, websiteSchema, { signal })
      return { success: true, output: { website: { ...data } } }
    },
    outputs: { website: WEBSITE_OUTPUT },
  }
}
