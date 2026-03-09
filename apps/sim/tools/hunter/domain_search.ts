import type { HunterDomainSearchParams, HunterDomainSearchResponse } from '@/tools/hunter/types'
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

    return {
      success: true,
      output: {
        domain: data.data?.domain || '',
        disposable: data.data?.disposable || false,
        webmail: data.data?.webmail || false,
        accept_all: data.data?.accept_all || false,
        pattern: data.data?.pattern || '',
        organization: data.data?.organization || '',
        description: data.data?.description || '',
        industry: data.data?.industry || '',
        twitter: data.data?.twitter || '',
        facebook: data.data?.facebook || '',
        linkedin: data.data?.linkedin || '',
        instagram: data.data?.instagram || '',
        youtube: data.data?.youtube || '',
        technologies: data.data?.technologies || [],
        country: data.data?.country || '',
        state: data.data?.state || '',
        city: data.data?.city || '',
        postal_code: data.data?.postal_code || '',
        street: data.data?.street || '',
        emails:
          data.data?.emails?.map((email: any) => ({
            value: email.value || '',
            type: email.type || '',
            confidence: email.confidence || 0,
            sources: email.sources || [],
            first_name: email.first_name || '',
            last_name: email.last_name || '',
            position: email.position || '',
            seniority: email.seniority || '',
            department: email.department || '',
            linkedin: email.linkedin || '',
            twitter: email.twitter || '',
            phone_number: email.phone_number || '',
            verification: email.verification || {},
          })) || [],
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
    description: {
      type: 'string',
      description: 'Description of the organization',
    },
    industry: {
      type: 'string',
      description: 'Industry classification of the organization',
    },
    twitter: {
      type: 'string',
      description: 'Twitter handle of the organization',
    },
    facebook: {
      type: 'string',
      description: 'Facebook page URL of the organization',
    },
    linkedin: {
      type: 'string',
      description: 'LinkedIn company page URL',
    },
    instagram: {
      type: 'string',
      description: 'Instagram profile of the organization',
    },
    youtube: {
      type: 'string',
      description: 'YouTube channel of the organization',
    },
    technologies: {
      type: 'array',
      description: 'Technologies used by the organization',
      items: {
        type: 'string',
        description: 'Technology name',
      },
    },
    country: {
      type: 'string',
      description: 'Country where the organization is headquartered',
    },
    state: {
      type: 'string',
      description: 'State/province where the organization is located',
    },
    city: {
      type: 'string',
      description: 'City where the organization is located',
    },
    postal_code: {
      type: 'string',
      description: 'Postal code of the organization',
    },
    street: {
      type: 'string',
      description: 'Street address of the organization',
    },
    emails: EMAILS_OUTPUT,
  },
}
