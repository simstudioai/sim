import { datagmaHosting } from '@/tools/datagma/hosting'
import type { DatagmaEnrichPersonParams, DatagmaEnrichPersonResponse } from '@/tools/datagma/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Enrich a person's profile from an email, LinkedIn URL, or full name + company.
 *
 * Endpoint: GET https://gateway.datagma.net/api/ingress/v2/full
 * Auth: apiId query param
 * Docs: https://datagmaapi.readme.io/reference/ingressservice_fullapiv2
 * Pricing: 2 credits per successful response; 30 additional credits when phone is found
 */
export const enrichPersonTool: ToolConfig<DatagmaEnrichPersonParams, DatagmaEnrichPersonResponse> =
  {
    id: 'datagma_enrich_person',
    name: 'Datagma Enrich Person',
    description:
      "Enrich a person's profile using their email, LinkedIn URL, or full name and company. Returns job title, company, location, and social data. Uses 2 credits per match; add 30 credits when a phone number is found.",
    version: '1.0.0',

    hosting: datagmaHosting<DatagmaEnrichPersonParams>((params, output) => {
      const name = output.name as string | null
      const email = output.email as string | null
      if (!name && !email) return 0
      // The 30-credit phone surcharge applies only when the caller requested a
      // phone lookup (phoneFull); a phone that rides along otherwise isn't charged.
      const phoneCredits = params.phoneFull && output.phone ? 30 : 0
      return 2 + phoneCredits
    }),

    params: {
      data: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Email address, LinkedIn URL, or full name (use companyKeyword when providing a name)',
      },
      companyKeyword: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Company name or keyword to disambiguate when data is a full name',
      },
      countryCode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Two-letter country code to improve match accuracy (e.g., 'US', 'GB')",
      },
      personFull: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Include education and work history in the response',
      },
      phoneFull: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Attempt to find a mobile phone number (costs 30 additional credits if found)',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Datagma API key',
      },
    },

    request: {
      url: (params) => {
        const url = new URL('https://gateway.datagma.net/api/ingress/v2/full')
        url.searchParams.set('apiId', params.apiKey)
        url.searchParams.set('data', params.data)
        if (params.companyKeyword) url.searchParams.set('companyKeyword', params.companyKeyword)
        if (params.countryCode) url.searchParams.set('countryCode', params.countryCode)
        if (params.personFull != null) url.searchParams.set('personFull', String(params.personFull))
        if (params.phoneFull != null) url.searchParams.set('phoneFull', String(params.phoneFull))
        return url.toString()
      },
      method: 'GET',
      headers: () => ({ Accept: 'application/json' }),
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          error:
            (errorData as Record<string, string>).message ||
            `Datagma API error: ${response.status} ${response.statusText}`,
          output: {
            name: null,
            firstName: null,
            lastName: null,
            email: null,
            emailStatus: null,
            jobTitle: null,
            company: null,
            linkedInUrl: null,
            location: null,
            country: null,
            region: null,
            city: null,
            extractedRole: null,
            extractedSeniority: null,
            twitter: null,
            phone: null,
            personConfidenceScore: null,
          },
        }
      }
      const data = (await response.json()) as Record<string, unknown>

      // Datagma nests phone numbers in an array; surface the first number's raw value
      const phones = data.phones as Array<Record<string, unknown>> | null | undefined
      const firstPhone =
        Array.isArray(phones) && phones.length > 0
          ? ((phones[0].number as string | null) ?? null)
          : null

      return {
        success: true,
        output: {
          name: (data.name as string | null) ?? null,
          firstName: (data.firstName as string | null) ?? null,
          lastName: (data.lastName as string | null) ?? null,
          email: (data.email as string | null) ?? null,
          emailStatus: (data.emailStatus as string | null) ?? null,
          jobTitle: (data.jobTitle as string | null) ?? null,
          company: (data.company as string | null) ?? null,
          linkedInUrl: (data.linkedInUrl as string | null) ?? null,
          location: (data.location as string | null) ?? null,
          country: (data.country as string | null) ?? null,
          region: (data.region as string | null) ?? null,
          city: (data.city as string | null) ?? null,
          extractedRole: (data.extractedRole as string | null) ?? null,
          extractedSeniority: (data.extractedSeniority as string | null) ?? null,
          twitter: (data.twitter as string | null) ?? null,
          phone: firstPhone,
          personConfidenceScore: (data.personConfidenceScore as number | null) ?? null,
        },
      }
    },

    outputs: {
      name: { type: 'string', description: 'Full name', optional: true },
      firstName: { type: 'string', description: 'First name', optional: true },
      lastName: { type: 'string', description: 'Last name', optional: true },
      email: { type: 'string', description: 'Work email address', optional: true },
      emailStatus: { type: 'string', description: 'Email verification status', optional: true },
      jobTitle: { type: 'string', description: 'Current job title', optional: true },
      company: { type: 'string', description: 'Current company name', optional: true },
      linkedInUrl: { type: 'string', description: 'LinkedIn profile URL', optional: true },
      location: { type: 'string', description: 'Location string', optional: true },
      country: { type: 'string', description: 'Country', optional: true },
      region: { type: 'string', description: 'Region/state', optional: true },
      city: { type: 'string', description: 'City', optional: true },
      extractedRole: { type: 'string', description: 'Extracted role category', optional: true },
      extractedSeniority: {
        type: 'string',
        description: 'Extracted seniority level',
        optional: true,
      },
      twitter: { type: 'string', description: 'Twitter handle', optional: true },
      phone: { type: 'string', description: 'Mobile phone number', optional: true },
      personConfidenceScore: {
        type: 'number',
        description: 'Confidence score for the person match (0–1)',
        optional: true,
      },
    },
  }
