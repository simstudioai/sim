import type { HunterDomainSearchParams, HunterDomainSearchResponse } from '@/tools/hunter/types'
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
      description: 'Domain name to search for email addresses',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum email addresses to return (default: 10)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'Number of email addresses to skip',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter for personal or generic emails',
    },
    seniority: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by seniority level: junior, senior, or executive',
    },
    department: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by specific departments (e.g., sales, marketing)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hunter.io API Key',
    },
  },

  outputs: {
    domain: {
      type: 'string',
      description: 'The searched domain name',
    },
    disposable: {
      type: 'boolean',
      description: 'Whether the domain accepts disposable email addresses',
    },
    webmail: {
      type: 'boolean',
      description: 'Whether the domain is a webmail provider',
    },
    accept_all: {
      type: 'boolean',
      description: 'Whether the domain accepts all email addresses',
    },
    pattern: {
      type: 'string',
      description: 'The email pattern used by the organization',
    },
    organization: {
      type: 'string',
      description: 'The organization name',
    },
    description: {
      type: 'string',
      description: 'Description of the organization',
    },
    industry: {
      type: 'string',
      description: 'Industry of the organization',
    },
    twitter: {
      type: 'string',
      description: 'Twitter profile of the organization',
    },
    facebook: {
      type: 'string',
      description: 'Facebook profile of the organization',
    },
    linkedin: {
      type: 'string',
      description: 'LinkedIn profile of the organization',
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
      description: 'Array of technologies used by the organization',
    },
    country: {
      type: 'string',
      description: 'Country where the organization is located',
    },
    state: {
      type: 'string',
      description: 'State where the organization is located',
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
    emails: {
      type: 'array',
      description:
        'Array of email addresses found for the domain, each containing value, type, confidence, sources, and person details',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.hunter.io/v2/domain-search')
      url.searchParams.append('domain', params.domain)
      url.searchParams.append('api_key', params.apiKey)

      if (params.limit) url.searchParams.append('limit', params.limit.toString())
      if (params.offset) url.searchParams.append('offset', params.offset.toString())
      if (params.type && params.type !== 'all') url.searchParams.append('type', params.type)
      if (params.seniority && params.seniority !== 'all')
        url.searchParams.append('seniority', params.seniority)
      if (params.department) url.searchParams.append('department', params.department)

      return url.toString()
    },
    method: 'GET',
    isInternalRoute: false,
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        data.errors?.[0]?.details || data.message || 'Failed to perform Hunter domain search'
      )
    }

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

  transformError: (error) => {
    return error instanceof Error
      ? error.message
      : 'An error occurred while performing the Hunter domain search'
  },
}
