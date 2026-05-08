import type {
  HunterDomainSearchParams,
  HunterDomainSearchResponse,
  HunterEmail,
} from '@/tools/hunter/types'
import { EMAILS_OUTPUT } from '@/tools/hunter/types'
import type { ToolConfig } from '@/tools/types'

export const domainSearchTool: ToolConfig<HunterDomainSearchParams, HunterDomainSearchResponse> = {
  id: 'hunter_domain_search',
  name: 'Hunter Domain Search',
  description: 'Returns all the email addresses found using one given domain name, with sources.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Domain name to search for email addresses (e.g., "stripe.com", "company.io")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum email addresses to return (e.g., 10, 25, 50). Default: 10',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of email addresses to skip for pagination (e.g., 0, 10, 20)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter for personal or generic emails (e.g., "personal", "generic", "all")',
    },
    seniority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by seniority level (e.g., "junior", "senior", "executive")',
    },
    department: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by specific department (e.g., "sales", "marketing", "engineering", "hr")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hunter.io API Key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.hunter.io/v2/domain-search')
      url.searchParams.append('domain', params.domain)
      url.searchParams.append('api_key', params.apiKey)

      if (params.limit) url.searchParams.append('limit', Number(params.limit).toString())
      if (params.offset) url.searchParams.append('offset', Number(params.offset).toString())
      if (params.type && params.type !== 'all') url.searchParams.append('type', params.type)
      if (params.seniority && params.seniority !== 'all')
        url.searchParams.append('seniority', params.seniority)
      if (params.department) url.searchParams.append('department', params.department)

      return url.toString()
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const d = data.data ?? {}

    return {
      success: true,
      output: {
        domain: d.domain ?? '',
        disposable: d.disposable ?? false,
        webmail: d.webmail ?? false,
        accept_all: d.accept_all ?? false,
        pattern: d.pattern ?? '',
        organization: d.organization ?? '',
        linked_domains: d.linked_domains ?? [],
        emails:
          d.emails?.map((email: Partial<HunterEmail>) => ({
            value: email.value ?? '',
            type: email.type ?? '',
            confidence: email.confidence ?? 0,
            sources: email.sources ?? [],
            first_name: email.first_name ?? null,
            last_name: email.last_name ?? null,
            position: email.position ?? null,
            position_raw: email.position_raw ?? null,
            seniority: email.seniority ?? null,
            department: email.department ?? null,
            linkedin: email.linkedin ?? null,
            twitter: email.twitter ?? null,
            phone_number: email.phone_number ?? null,
            verification: email.verification ?? { date: null, status: 'unknown' },
          })) ?? [],
      },
    }
  },

  outputs: {
    domain: {
      type: 'string',
      description: 'The searched domain name',
    },
    disposable: {
      type: 'boolean',
      description: 'Whether the domain is a disposable email service',
    },
    webmail: {
      type: 'boolean',
      description: 'Whether the domain is a webmail provider (e.g., Gmail)',
    },
    accept_all: {
      type: 'boolean',
      description: 'Whether the server accepts all email addresses (may cause false positives)',
    },
    pattern: {
      type: 'string',
      description: 'The email pattern used by the organization (e.g., {first}, {first}.{last})',
    },
    organization: {
      type: 'string',
      description: 'The organization/company name',
    },
    linked_domains: {
      type: 'array',
      description: 'Other domains linked to the organization',
      items: { type: 'string', description: 'Domain name' },
    },
    emails: EMAILS_OUTPUT,
  },
}
