import { sleep } from '@sim/utils/helpers'
import type { ToolConfig } from '@/tools/types'
import { wizaHosting } from '@/tools/wiza/hosting'
import type {
  WizaIndividualRevealData,
  WizaIndividualRevealParams,
  WizaIndividualRevealResponse,
} from '@/tools/wiza/types'

const POLL_INTERVAL_MS = 2000
const MAX_POLL_TIME_MS = 120000
/** Tolerate brief Wiza outages while polling before giving up on an already-started reveal. */
const MAX_CONSECUTIVE_POLL_ERRORS = 3

/** Whether a reveal payload has reached a terminal state and no longer needs polling. */
function isTerminalReveal(d: { status?: string | null; is_complete?: boolean | null }): boolean {
  return d.status === 'finished' || d.status === 'failed' || d.is_complete === true
}

/** Map a Wiza individual-reveal payload (`data` object) to the tool output shape. */
function mapRevealData(d: Record<string, unknown>): WizaIndividualRevealData {
  const emails = Array.isArray(d.emails) ? (d.emails as Record<string, unknown>[]) : []
  const phones = Array.isArray(d.phones) ? (d.phones as Record<string, unknown>[]) : []
  return {
    id: (d.id as number) ?? null,
    status: (d.status as string) ?? null,
    is_complete: (d.is_complete as boolean) ?? null,
    name: (d.name as string) ?? null,
    company: (d.company as string) ?? null,
    enrichment_level: (d.enrichment_level as string) ?? null,
    linkedin_profile_url: (d.linkedin_profile_url as string) ?? null,
    title: (d.title as string) ?? null,
    location: (d.location as string) ?? null,
    email: (d.email as string) ?? null,
    email_type: (d.email_type as string) ?? null,
    email_status: (d.email_status as string) ?? null,
    emails: emails.map((e) => ({
      email: (e.email as string) ?? null,
      email_type: (e.email_type as string) ?? null,
      email_status: (e.email_status as string) ?? null,
    })),
    mobile_phone: (d.mobile_phone as string) ?? null,
    phone_number: (d.phone_number as string) ?? null,
    phone_status: (d.phone_status as string) ?? null,
    phones: phones.map((p) => ({
      number: (p.number as string) ?? null,
      pretty_number: (p.pretty_number as string) ?? null,
      type: (p.type as string) ?? null,
    })),
    company_size: (d.company_size as number) ?? null,
    company_size_range: (d.company_size_range as string) ?? null,
    company_type: (d.company_type as string) ?? null,
    company_domain: (d.company_domain as string) ?? null,
    company_locality: (d.company_locality as string) ?? null,
    company_region: (d.company_region as string) ?? null,
    company_country: (d.company_country as string) ?? null,
    company_street: (d.company_street as string) ?? null,
    company_postal_code: (d.company_postal_code as string) ?? null,
    company_founded: (d.company_founded as number) ?? null,
    company_funding: (d.company_funding as string) ?? null,
    company_revenue: (d.company_revenue as string) ?? null,
    company_industry: (d.company_industry as string) ?? null,
    company_subindustry: (d.company_subindustry as string) ?? null,
    company_linkedin: (d.company_linkedin as string) ?? null,
    company_location: (d.company_location as string) ?? null,
    company_description: (d.company_description as string) ?? null,
    credits: (d.credits as Record<string, unknown>) ?? null,
  }
}

export const wizaIndividualRevealTool: ToolConfig<
  WizaIndividualRevealParams,
  WizaIndividualRevealResponse
> = {
  id: 'wiza_individual_reveal',
  name: 'Wiza Individual Reveal',
  description:
    'Reveal a contact via LinkedIn URL, name + company/domain, or email. Starts the reveal and polls until it resolves. Uses 2 credits per valid email and 5 credits per phone, charged only on success.',
  version: '1.0.0',

  hosting: wizaHosting<WizaIndividualRevealParams>((_params, output) => {
    let credits = 0
    const emails = Array.isArray(output.emails)
      ? (output.emails as { email_status?: string }[])
      : []
    const emailValid =
      output.email_status === 'valid' || emails.some((e) => e.email_status === 'valid')
    // 2 credits when at least one valid email is returned.
    if (emailValid) credits += 2
    const phones = Array.isArray(output.phones) ? output.phones : []
    const phoneFound = Boolean(output.mobile_phone || output.phone_number || phones.length > 0)
    // 5 credits when at least one phone is returned.
    if (phoneFound) credits += 5
    return credits
  }),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Wiza API key',
    },
    enrichment_level: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Enrichment depth: none, partial, phone, or full',
    },
    profile_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL (e.g., https://linkedin.com/in/johndoe)',
    },
    full_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name (used with company or domain)',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (used with full_name)',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain (used with full_name)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address (use alone or with other identifiers)',
    },
    accept_work: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to accept work emails (email_options)',
    },
    accept_personal: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to accept personal emails (email_options)',
    },
  },

  request: {
    url: 'https://wiza.co/api/individual_reveals',
    method: 'POST',
    headers: (params: WizaIndividualRevealParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: WizaIndividualRevealParams) => {
      const individual: Record<string, unknown> = {}
      if (params.profile_url) individual.profile_url = params.profile_url
      if (params.full_name) individual.full_name = params.full_name
      if (params.company) individual.company = params.company
      if (params.domain) individual.domain = params.domain
      if (params.email) individual.email = params.email

      const body: Record<string, unknown> = {
        individual_reveal: individual,
        enrichment_level: params.enrichment_level,
      }

      if (params.accept_work !== undefined || params.accept_personal !== undefined) {
        const emailOptions: Record<string, unknown> = {}
        if (params.accept_work !== undefined) emailOptions.accept_work = params.accept_work
        if (params.accept_personal !== undefined) {
          emailOptions.accept_personal = params.accept_personal
        }
        body.email_options = emailOptions
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Wiza API error: ${response.status} - ${errorText}`)
    }
    const json = await response.json()
    return {
      success: true,
      output: mapRevealData(json.data ?? {}),
    }
  },

  postProcess: async (result, params) => {
    if (!result.success) return result

    // Wiza can resolve synchronously (e.g. a cache hit) — the initial POST payload is
    // already mapped, so skip polling when it is terminal.
    if (isTerminalReveal(result.output)) {
      return { success: result.output.status !== 'failed', output: result.output }
    }

    const revealId = result.output.id
    if (revealId == null) {
      // Return an explicit failure rather than throwing: a thrown error here is swallowed
      // by the executor and masked as the queued (incomplete) success result.
      return {
        success: false,
        error: 'Wiza individual reveal did not return an id',
        output: result.output,
      }
    }

    let elapsedTime = 0
    let consecutiveErrors = 0
    while (elapsedTime < MAX_POLL_TIME_MS) {
      await sleep(POLL_INTERVAL_MS)
      elapsedTime += POLL_INTERVAL_MS

      const statusResponse = await fetch(
        `https://wiza.co/api/individual_reveals/${encodeURIComponent(String(revealId))}`,
        {
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!statusResponse.ok) {
        // The reveal is already started (and billed by Wiza), so tolerate brief outages and
        // retry rather than aborting the whole window on a single transient 5xx/429.
        consecutiveErrors += 1
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          const errorText = await statusResponse.text().catch(() => '')
          return {
            success: false,
            error: `Wiza API error: ${statusResponse.status} - ${errorText}`,
            output: result.output,
          }
        }
        continue
      }
      consecutiveErrors = 0

      const json = await statusResponse.json()
      const data = json.data ?? {}

      if (isTerminalReveal(data)) {
        return {
          success: data.status !== 'failed',
          output: mapRevealData(data),
        }
      }
    }

    return {
      success: false,
      error: 'Wiza individual reveal did not complete within the polling window',
      output: result.output,
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
    credits: { type: 'json', description: 'Credits consumed by the reveal', optional: true },
  },
}
