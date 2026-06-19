import { sleep } from '@sim/utils/helpers'
import { dropcontactHosting } from '@/tools/dropcontact/hosting'
import type {
  DropcontactEmailEntry,
  DropcontactEnrichContactParams,
  DropcontactEnrichContactResponse,
  DropcontactEnrichedContact,
} from '@/tools/dropcontact/types'
import type { ToolConfig } from '@/tools/types'

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = 120000

/**
 * Map the first contact from the Dropcontact poll result data array to the
 * flat tool output shape.
 *
 * @param contact - Raw contact object from the Dropcontact API poll response
 * @returns Structured output matching `DropcontactEnrichContactResponse.output`
 */
function mapContactData(
  requestId: string | null,
  contact: DropcontactEnrichedContact
): DropcontactEnrichContactResponse['output'] {
  const emailEntries = Array.isArray(contact.email)
    ? (contact.email as DropcontactEmailEntry[])
    : null
  const firstEmail = emailEntries?.[0] ?? null

  return {
    request_id: requestId,
    email_found: Boolean(firstEmail?.email),
    email: firstEmail?.email ?? null,
    emails: emailEntries,
    qualification: firstEmail?.qualification ?? null,
    first_name: contact.first_name ?? null,
    last_name: contact.last_name ?? null,
    full_name: contact.full_name ?? null,
    civility: contact.civility ?? null,
    phone: contact.phone ?? null,
    mobile_phone: contact.mobile_phone ?? null,
    company: contact.company ?? null,
    website: contact.website ?? null,
    company_linkedin: contact.company_linkedin ?? null,
    linkedin: contact.linkedin ?? null,
    country: contact.country ?? null,
    siren: contact.siren ?? null,
    siret: contact.siret ?? null,
    siret_address: contact.siret_address ?? null,
    siret_zip: contact.siret_zip ?? null,
    siret_city: contact.siret_city ?? null,
    vat: contact.vat ?? null,
    nb_employees: contact.nb_employees ?? null,
    employee_count: contact.employee_count ?? null,
    naf5_code: contact.naf5_code ?? null,
    naf5_des: contact.naf5_des ?? null,
    industry: contact.industry ?? null,
    job: contact.job ?? null,
    job_level: contact.job_level ?? null,
    job_function: contact.job_function ?? null,
    company_turnover: contact.company_turnover ?? null,
    company_results: contact.company_results ?? null,
  }
}

export const dropcontactEnrichContactTool: ToolConfig<
  DropcontactEnrichContactParams,
  DropcontactEnrichContactResponse
> = {
  id: 'dropcontact_enrich_contact',
  name: 'Dropcontact Enrich Contact',
  description:
    'Enrich a contact with verified B2B email, phone, company data, and LinkedIn info via Dropcontact. Submits an async enrichment request, then polls until the result is ready (up to 2 minutes). Charges 1 credit only when a verified email is returned. Provide at least one of: email, first_name+last_name+company, full_name+company, or linkedin URL.',
  version: '1.0.0',

  hosting: dropcontactHosting<DropcontactEnrichContactParams>((_params, output) => {
    // 1 credit per contact when a verified email is found.
    // Source: https://developer.dropcontact.com (retrieved 2026-05)
    return output.email_found === true ? 1 : 0
  }),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dropcontact API key (X-Access-Token)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the contact to enrich',
    },
    first_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the contact',
    },
    last_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the contact',
    },
    full_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name (alternative to first_name + last_name)',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name',
    },
    website: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website (e.g. acme.com)',
    },
    num_siren: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'French company SIREN number',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number',
    },
    linkedin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code (ISO 3166-1 alpha-2, e.g. "US", "FR")',
    },
    siren: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include SIREN/SIRET enrichment (France only)',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language for returned data (e.g. "en", "fr")',
    },
  },

  request: {
    // Submit endpoint: POST https://api.dropcontact.com/v1/enrich/all
    // Source: https://developer.dropcontact.com (retrieved 2026-05)
    url: 'https://api.dropcontact.com/v1/enrich/all',
    method: 'POST',
    headers: (params: DropcontactEnrichContactParams) => ({
      'X-Access-Token': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params: DropcontactEnrichContactParams) => {
      const contact: Record<string, unknown> = {}
      if (params.email) contact.email = params.email
      if (params.first_name) contact.first_name = params.first_name
      if (params.last_name) contact.last_name = params.last_name
      if (params.full_name) contact.full_name = params.full_name
      if (params.company) contact.company = params.company
      if (params.website) contact.website = params.website
      if (params.num_siren) contact.num_siren = params.num_siren
      if (params.phone) contact.phone = params.phone
      if (params.linkedin) contact.linkedin = params.linkedin
      if (params.country) contact.country = params.country

      const body: Record<string, unknown> = { data: [contact] }
      if (params.siren !== undefined) body.siren = params.siren
      if (params.language) body.language = params.language

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Dropcontact API error: ${response.status} - ${errorText}`)
    }
    const json = await response.json()
    if (json.error) {
      throw new Error(`Dropcontact API error: ${String(json.reason ?? json.error)}`)
    }
    // Submit response includes request_id; enrichment is async
    return {
      success: true,
      output: {
        request_id: (json.request_id as string) ?? null,
        email_found: false,
        email: null,
        emails: null,
        qualification: null,
        first_name: null,
        last_name: null,
        full_name: null,
        civility: null,
        phone: null,
        mobile_phone: null,
        company: null,
        website: null,
        company_linkedin: null,
        linkedin: null,
        country: null,
        siren: null,
        siret: null,
        siret_address: null,
        siret_zip: null,
        siret_city: null,
        vat: null,
        nb_employees: null,
        employee_count: null,
        naf5_code: null,
        naf5_des: null,
        industry: null,
        job: null,
        job_level: null,
        job_function: null,
        company_turnover: null,
        company_results: null,
      },
    }
  },

  postProcess: async (result, params) => {
    if (!result.success) return result

    const requestId = result.output.request_id
    if (!requestId) {
      throw new Error('Dropcontact enrichment did not return a request_id')
    }

    let elapsedTime = 0
    while (elapsedTime < MAX_POLL_TIME_MS) {
      await sleep(POLL_INTERVAL_MS)
      elapsedTime += POLL_INTERVAL_MS

      // Poll endpoint: GET https://api.dropcontact.com/v1/enrich/all/{request_id}
      // Source: https://developer.dropcontact.com (retrieved 2026-05)
      const pollResponse = await fetch(
        `https://api.dropcontact.com/v1/enrich/all/${encodeURIComponent(requestId)}`,
        {
          headers: {
            'X-Access-Token': params.apiKey,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text()
        throw new Error(`Dropcontact poll error: ${pollResponse.status} - ${errorText}`)
      }

      const json = await pollResponse.json()

      // Error state: { error: true|string, reason?: string }
      if (json.error) {
        throw new Error(`Dropcontact enrichment failed: ${String(json.reason ?? json.error)}`)
      }

      // Pending: { success: false, error: false, reason: "Request not ready yet..." }
      if (!json.success) continue

      // Ready: { success: true, data: [...], error: false }

      const contacts = Array.isArray(json.data) ? json.data : []
      const contact = (contacts[0] ?? {}) as DropcontactEnrichedContact

      return {
        success: true,
        output: mapContactData(requestId, contact),
      }
    }

    throw new Error('Dropcontact enrichment did not complete within the polling window')
  },

  outputs: {
    request_id: { type: 'string', description: 'Dropcontact async request ID', optional: true },
    email_found: { type: 'boolean', description: 'Whether a verified email was found' },
    email: { type: 'string', description: 'Primary verified email address', optional: true },
    emails: {
      type: 'array',
      description: 'All email addresses returned (each with email and qualification)',
      optional: true,
      items: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address' },
          qualification: {
            type: 'string',
            description: 'Email qualification (e.g. nominative@pro)',
          },
        },
      },
    },
    qualification: {
      type: 'string',
      description: 'Primary email qualification (e.g. nominative@pro, catch_all@pro)',
      optional: true,
    },
    first_name: { type: 'string', description: 'First name', optional: true },
    last_name: { type: 'string', description: 'Last name', optional: true },
    full_name: { type: 'string', description: 'Full name', optional: true },
    civility: { type: 'string', description: 'Civility (Mr, Mrs, etc.)', optional: true },
    phone: { type: 'string', description: 'Phone number', optional: true },
    mobile_phone: { type: 'string', description: 'Mobile phone number', optional: true },
    company: { type: 'string', description: 'Company name', optional: true },
    website: { type: 'string', description: 'Company website', optional: true },
    company_linkedin: { type: 'string', description: 'Company LinkedIn URL', optional: true },
    linkedin: { type: 'string', description: 'Personal LinkedIn URL', optional: true },
    country: { type: 'string', description: 'Country code (ISO 3166-1 alpha-2)', optional: true },
    siren: { type: 'string', description: 'French SIREN number', optional: true },
    siret: { type: 'string', description: 'French SIRET number', optional: true },
    siret_address: { type: 'string', description: 'SIRET registered address', optional: true },
    siret_zip: { type: 'string', description: 'SIRET registered postal code', optional: true },
    siret_city: { type: 'string', description: 'SIRET registered city', optional: true },
    vat: { type: 'string', description: 'VAT number', optional: true },
    nb_employees: { type: 'string', description: 'Employee count range', optional: true },
    employee_count: {
      type: 'number',
      description: 'Exact employee count (Growth plan and above)',
      optional: true,
    },
    naf5_code: { type: 'string', description: 'NAF/APE code (France)', optional: true },
    naf5_des: {
      type: 'string',
      description: 'NAF/APE code description (France)',
      optional: true,
    },
    industry: { type: 'string', description: 'Industry classification', optional: true },
    job: { type: 'string', description: 'Job title', optional: true },
    job_level: {
      type: 'string',
      description: 'Job seniority level (e.g. C-level, Director)',
      optional: true,
    },
    job_function: {
      type: 'string',
      description: 'Job function (e.g. Sales, Engineering)',
      optional: true,
    },
    company_turnover: {
      type: 'string',
      description: 'Company revenue/turnover range',
      optional: true,
    },
    company_results: { type: 'string', description: 'Company net results', optional: true },
  },
}
