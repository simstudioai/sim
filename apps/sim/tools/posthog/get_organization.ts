import type { ToolConfig } from '@/tools/types'

export interface PostHogGetOrganizationParams {
  organizationId: string
  apiKey: string
  region?: 'us' | 'eu'
}

export interface PostHogOrganizationDetail {
  id: string
  name: string
  slug: string
  created_at: string
  updated_at: string
  membership_level: number
  plugins_access_level: number
  teams: number[]
  available_product_features: Array<{
    key: string
    name: string
    description: string
    unit: string
    limit: number | null
    note: string | null
  }>
  domain_whitelist: string[]
  is_member_join_email_enabled: boolean
  metadata: Record<string, any>
  customer_id: string | null
  available_features: string[]
  usage: Record<string, any> | null
}

export interface PostHogGetOrganizationResponse {
  success: boolean
  output: {
    organization: PostHogOrganizationDetail
  }
  error?: string
}

export const getOrganizationTool: ToolConfig<
  PostHogGetOrganizationParams,
  PostHogGetOrganizationResponse
> = {
  id: 'posthog_get_organization',
  name: 'PostHog Get Organization',
  description:
    'Get detailed information about a specific organization by ID. Returns comprehensive organization settings, features, usage, and team information.',
  version: '1.0.0',

  params: {
    organizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Organization ID (e.g., "01234567-89ab-cdef-0123-456789abcdef")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostHog Personal API Key',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Cloud region: us or eu (default: us)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/organizations/${params.organizationId}/`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        organization: {
          id: data.id,
          name: data.name,
          slug: data.slug,
          created_at: data.created_at,
          updated_at: data.updated_at,
          membership_level: data.membership_level,
          plugins_access_level: data.plugins_access_level,
          teams: data.teams || [],
          available_product_features: data.available_product_features || [],
          domain_whitelist: data.domain_whitelist || [],
          is_member_join_email_enabled: data.is_member_join_email_enabled,
          metadata: data.metadata || {},
          customer_id: data.customer_id ?? null,
          available_features: data.available_features || [],
          usage: data.usage ?? null,
        },
      },
    }
  },

  outputs: {
    organization: {
      type: 'object',
      description: 'Detailed organization information with settings and features',
      properties: {
        id: { type: 'string', description: 'Organization ID (UUID)' },
        name: { type: 'string', description: 'Organization name' },
        slug: { type: 'string', description: 'Organization slug' },
        created_at: { type: 'string', description: 'Organization creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
        membership_level: {
          type: 'number',
          description: 'User membership level in organization',
        },
        plugins_access_level: {
          type: 'number',
          description: 'Access level for plugins/apps',
        },
        teams: { type: 'array', description: 'List of team IDs in this organization' },
        available_product_features: {
          type: 'array',
          description: 'Available product features with their limits and descriptions',
        },
        domain_whitelist: {
          type: 'array',
          description: 'Whitelisted domains for organization',
        },
        is_member_join_email_enabled: {
          type: 'boolean',
          description: 'Whether member join emails are enabled',
        },
        metadata: { type: 'object', description: 'Organization metadata' },
        customer_id: { type: 'string', description: 'Customer ID for billing', optional: true },
        available_features: {
          type: 'array',
          description: 'List of available feature flags for organization',
        },
        usage: { type: 'object', description: 'Organization usage statistics', optional: true },
      },
    },
  },
}
