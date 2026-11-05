import { toStringOrNull } from '@sim/utils/coerce'
import { filterUndefined, isRecordLike, toArray, toRecord } from '@sim/utils/object'
import { normalizeDomain, splitName } from '@/enrichments/providers'
import { firecrawlHosting } from '@/tools/firecrawl/hosting'
import type { FirecrawlEnrichParams, FirecrawlEnrichResponse } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

function enrichmentCall(params: FirecrawlEnrichParams) {
  const fullName = params.fullName?.trim()
  const companyDomain = normalizeDomain(params.companyDomain)
  const companyName = params.companyName?.trim()
  const linkedinUrl = params.linkedinUrl?.trim()
  const email = params.email?.trim()

  switch (params.enrichmentType) {
    case 'work_email':
    case 'phone': {
      const name = splitName(fullName)
      const company = companyDomain || companyName
      if (!linkedinUrl && !(fullName && company)) {
        throw new Error('Provide a LinkedIn URL or a full name and company for contact enrichment')
      }
      if (!linkedinUrl && !name) {
        const fields =
          params.enrichmentType === 'phone' ? ['mobile_phone', 'phone_numbers'] : ['work_email']
        return {
          provider: 'people-data-labs',
          capability: 'person/enrich',
          options: {
            name: fullName,
            company,
            min_likelihood: 6,
            required: fields.join(' OR '),
            data_include: fields.join(','),
          },
        }
      }
      return {
        provider: 'fullenrich',
        capability: params.enrichmentType === 'phone' ? 'contacts/mobile' : 'contacts/work-email',
        options: filterUndefined({
          linkedin_url: linkedinUrl || undefined,
          first_name: name?.firstName,
          last_name: name?.lastName,
          domain: companyDomain || undefined,
          company_name: companyName || undefined,
        }),
      }
    }
    case 'linkedin':
      if (email) {
        return { provider: 'fullenrich', capability: 'contacts/reverse-email', options: { email } }
      }
      if (!fullName || !(companyDomain || companyName)) {
        throw new Error('Provide an email or a full name and company for LinkedIn enrichment')
      }
      return {
        provider: 'people-data-labs',
        capability: 'person/enrich',
        options: {
          name: fullName,
          company: companyDomain || companyName,
          min_likelihood: 6,
          required: 'linkedin_url',
          data_include: 'linkedin_url',
        },
      }
    case 'company':
      if (!companyDomain) throw new Error('Provide a company domain for company enrichment')
      return {
        provider: 'people-data-labs',
        capability: 'company/enrich',
        options: {
          website: companyDomain,
          min_likelihood: 6,
          required: 'employee_count OR summary',
          data_include: 'employee_count,size,summary,website',
        },
      }
    case 'company_domain':
      if (!companyName) throw new Error('Provide a company name to find its domain')
      return {
        provider: 'people-data-labs',
        capability: 'company/enrich',
        options: {
          name: companyName,
          required: 'website',
          data_include: 'website',
        },
      }
    default:
      throw new Error('Unsupported Firecrawl enrichment type')
  }
}

/** Single-record Alexandria lookups, billed from Firecrawl's reported creditsCost. */
export const firecrawlEnrichTool: ToolConfig<FirecrawlEnrichParams, FirecrawlEnrichResponse> = {
  id: 'firecrawl_enrich',
  name: 'Firecrawl Enrich',
  description:
    'Find work emails, phone numbers, LinkedIn profiles, company domains, and company information through Firecrawl Alexandria. Uses FullEnrich for contact lookups and People Data Labs for company, name-based profile, and single-part-name contact lookups. Provider terms must be enabled in Firecrawl. People Data Labs has a 50,000-record annual team limit.',
  version: '1.0.0',
  hosting: firecrawlHosting<FirecrawlEnrichParams>(),
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
    enrichmentType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Lookup type: work_email, phone, linkedin, company, or company_domain',
    },
    fullName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name of the person',
    },
    companyDomain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website domain',
    },
    companyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name when the domain is unknown',
    },
    linkedinUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL for work email or mobile lookup',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address for reverse LinkedIn profile lookup',
    },
  },
  request: {
    url: 'https://api.firecrawl.dev/v2/scrape',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ alexandria: enrichmentCall(params) }),
  },
  transformResponse: async (response) => {
    const envelope = toRecord(await response.json())
    const data = toRecord(envelope.data)
    const results = toArray(data.alexandria)
    const result = toRecord(results[0])
    const error = toRecord(result.error)
    const output: FirecrawlEnrichResponse['output'] = {
      email: null,
      emailVerified: false,
      phone: null,
      linkedinUrl: null,
      domain: null,
      employeeCount: null,
      description: null,
      creditsUsed: 0,
      statusCode: typeof error.status === 'number' ? error.status : response.status,
    }
    if (!response.ok || envelope.success !== true || result.error) {
      return {
        success: false,
        error:
          toStringOrNull(error.message) ??
          toStringOrNull(envelope.error) ??
          `Firecrawl enrichment failed (${output.statusCode})`,
        output,
      }
    }
    if (results.length !== 1 || !isRecordLike(result.data)) {
      throw new Error('Firecrawl enrichment response missing its single provider result')
    }
    if (
      typeof data.creditsCost !== 'number' ||
      !Number.isFinite(data.creditsCost) ||
      data.creditsCost < 0
    ) {
      throw new Error('Firecrawl enrichment response missing valid creditsCost')
    }
    output.creditsUsed = data.creditsCost
    const record = result.data
    if (result.provider === 'fullenrich') {
      const contact = toRecord(toArray(record.results)[0])
      const contactInfo = toRecord(contact.contact_info)
      const workEmail = toRecord(contactInfo.most_probable_work_email)
      const phone = toRecord(contactInfo.most_probable_phone)
      const profile = toRecord(contact.profile)
      const social = toRecord(toRecord(profile.social_profiles).professional_network)
      output.email = toStringOrNull(workEmail.email)
      output.emailVerified = workEmail.status === 'DELIVERABLE'
      output.phone = toStringOrNull(phone.number)
      output.linkedinUrl = toStringOrNull(social.url)
    } else if (result.provider === 'people-data-labs') {
      const person = toRecord(record.data)
      output.email = toStringOrNull(person.work_email)
      output.phone =
        toStringOrNull(person.mobile_phone) ||
        toArray(person.phone_numbers)
          .map(toStringOrNull)
          .find((phone) => phone?.trim()) ||
        null
      output.linkedinUrl = toStringOrNull(person.linkedin_url)
      output.domain = toStringOrNull(record.website)
      output.employeeCount =
        typeof record.employee_count === 'number'
          ? String(record.employee_count)
          : toStringOrNull(record.size)
      output.description = toStringOrNull(record.summary)
    } else {
      throw new Error('Firecrawl enrichment returned an unexpected provider result')
    }
    return { success: true, output }
  },
  outputs: {
    email: { type: 'string', description: 'Work email, when found', optional: true },
    emailVerified: {
      type: 'boolean',
      description:
        'True only when FullEnrich reports DELIVERABLE; catch-all and high-probability addresses remain unverified',
    },
    phone: {
      type: 'string',
      description: 'Phone number, preferring mobile when available',
      optional: true,
    },
    linkedinUrl: {
      type: 'string',
      description: 'LinkedIn profile URL, when found',
      optional: true,
    },
    domain: { type: 'string', description: 'Company website domain, when found', optional: true },
    employeeCount: {
      type: 'string',
      description: 'Company headcount or size range',
      optional: true,
    },
    description: { type: 'string', description: 'Company description', optional: true },
    creditsUsed: { type: 'number', description: 'Firecrawl credits charged for this lookup' },
    statusCode: { type: 'number', description: 'Provider or HTTP response status code' },
  },
}
