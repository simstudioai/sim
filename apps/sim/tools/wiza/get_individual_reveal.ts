import type { ToolConfig } from '@/tools/types'
import type {
  WizaGetIndividualRevealParams,
  WizaGetIndividualRevealResponse,
} from '@/tools/wiza/types'

export const wizaGetIndividualRevealTool: ToolConfig<
  WizaGetIndividualRevealParams,
  WizaGetIndividualRevealResponse
> = {
  id: 'wiza_get_individual_reveal',
  name: 'Wiza Get Individual Reveal',
  description: 'Retrieve the status and enriched data for an individual reveal by ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Wiza API key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Individual reveal ID returned from Start Individual Reveal',
    },
  },

  request: {
    url: (params: WizaGetIndividualRevealParams) =>
      `https://wiza.co/api/individual_reveals/${encodeURIComponent(String(params.id).trim())}`,
    method: 'GET',
    headers: (params: WizaGetIndividualRevealParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Wiza API error: ${response.status} - ${errorText}`)
    }

    const json = await response.json()
    const d = json.data ?? {}
    const emails = Array.isArray(d.emails) ? d.emails : []
    const phones = Array.isArray(d.phones) ? d.phones : []

    return {
      success: true,
      output: {
        id: d.id ?? null,
        status: d.status ?? null,
        is_complete: d.is_complete ?? null,
        name: d.name ?? null,
        company: d.company ?? null,
        enrichment_level: d.enrichment_level ?? null,
        linkedin_profile_url: d.linkedin_profile_url ?? null,
        title: d.title ?? null,
        location: d.location ?? null,
        email: d.email ?? null,
        email_type: d.email_type ?? null,
        email_status: d.email_status ?? null,
        emails: emails.map((e: Record<string, unknown>) => ({
          email: (e.email as string) ?? null,
          email_type: (e.email_type as string) ?? null,
          email_status: (e.email_status as string) ?? null,
        })),
        mobile_phone: d.mobile_phone ?? null,
        phone_number: d.phone_number ?? null,
        phone_status: d.phone_status ?? null,
        phones: phones.map((p: Record<string, unknown>) => ({
          number: (p.number as string) ?? null,
          pretty_number: (p.pretty_number as string) ?? null,
          type: (p.type as string) ?? null,
        })),
        company_size: d.company_size ?? null,
        company_size_range: d.company_size_range ?? null,
        company_type: d.company_type ?? null,
        company_domain: d.company_domain ?? null,
        company_locality: d.company_locality ?? null,
        company_region: d.company_region ?? null,
        company_country: d.company_country ?? null,
        company_street: d.company_street ?? null,
        company_postal_code: d.company_postal_code ?? null,
        company_founded: d.company_founded ?? null,
        company_funding: d.company_funding ?? null,
        company_revenue: d.company_revenue ?? null,
        company_industry: d.company_industry ?? null,
        company_subindustry: d.company_subindustry ?? null,
        company_linkedin: d.company_linkedin ?? null,
        company_location: d.company_location ?? null,
        company_description: d.company_description ?? null,
        credits: d.credits ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Reveal ID' },
    status: { type: 'string', description: 'queued | resolving | finished | failed' },
    is_complete: { type: 'boolean', description: 'Whether the reveal has completed' },
    name: { type: 'string', description: 'Full name', optional: true },
    company: { type: 'string', description: 'Company name', optional: true },
    enrichment_level: { type: 'string', description: 'Enrichment level used', optional: true },
    linkedin_profile_url: { type: 'string', description: 'LinkedIn URL', optional: true },
    title: { type: 'string', description: 'Job title', optional: true },
    location: { type: 'string', description: 'Location', optional: true },
    email: { type: 'string', description: 'Primary email', optional: true },
    email_type: { type: 'string', description: 'Email type', optional: true },
    email_status: { type: 'string', description: 'valid | risky | unfound', optional: true },
    emails: {
      type: 'array',
      description: 'All emails found',
      optional: true,
      items: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          email_type: { type: 'string' },
          email_status: { type: 'string' },
        },
      },
    },
    mobile_phone: { type: 'string', description: 'Mobile phone', optional: true },
    phone_number: { type: 'string', description: 'Direct/office phone', optional: true },
    phone_status: { type: 'string', description: 'found | unfound', optional: true },
    phones: {
      type: 'array',
      description: 'All phones found',
      optional: true,
      items: {
        type: 'object',
        properties: {
          number: { type: 'string' },
          pretty_number: { type: 'string' },
          type: { type: 'string' },
        },
      },
    },
    company_size: { type: 'number', description: 'Employee count', optional: true },
    company_size_range: { type: 'string', description: 'Headcount range', optional: true },
    company_type: { type: 'string', description: 'Company type', optional: true },
    company_domain: { type: 'string', description: 'Company domain', optional: true },
    company_locality: { type: 'string', description: 'City', optional: true },
    company_region: { type: 'string', description: 'State/region', optional: true },
    company_country: { type: 'string', description: 'Country', optional: true },
    company_street: { type: 'string', description: 'Street', optional: true },
    company_postal_code: { type: 'string', description: 'Postal code', optional: true },
    company_founded: { type: 'number', description: 'Year founded', optional: true },
    company_funding: { type: 'string', description: 'Funding total', optional: true },
    company_revenue: { type: 'string', description: 'Revenue', optional: true },
    company_industry: { type: 'string', description: 'Industry', optional: true },
    company_subindustry: { type: 'string', description: 'Subindustry', optional: true },
    company_linkedin: { type: 'string', description: 'Company LinkedIn URL', optional: true },
    company_location: { type: 'string', description: 'Full company location', optional: true },
    company_description: { type: 'string', description: 'Company description', optional: true },
    credits: { type: 'json', description: 'Remaining credits balance', optional: true },
  },
}
