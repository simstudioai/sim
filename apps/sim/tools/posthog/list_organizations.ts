import type { ToolConfig } from '@/tools/types'

export interface PostHogListOrganizationsParams {
  apiKey: string
  region?: 'us' | 'eu'
}

export interface PostHogOrganization {
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
}

export interface PostHogListOrganizationsResponse {
  success: boolean
  output: {
    organizations: PostHogOrganization[]
  }
  error?: string
}

export const listOrganizationsTool: ToolConfig<
  PostHogListOrganizationsParams,
  PostHogListOrganizationsResponse
> = {
  id: 'posthog_list_organizations',
  name: 'PostHog List Organizations',
  description:
    'List all organizations the user has access to. Returns organization details including name, slug, membership level, and available product features.',
  version: '1.0.0',

  params: {
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
      return `${baseUrl}/api/organizations/`
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
        organizations: data.results.map((org: any) => ({
          id: org.id,
          name: org.name,
          slug: org.slug,
          created_at: org.created_at,
          updated_at: org.updated_at,
          membership_level: org.membership_level,
          plugins_access_level: org.plugins_access_level,
          teams: org.teams || [],
          available_product_features: org.available_product_features || [],
        })),
      },
    }
  },

  outputs: {
    organizations: {
      type: 'array',
      description: 'List of organizations with their settings and features',
      items: {
        type: 'object',
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
            description: 'Available product features and their limits',
          },
        },
      },
    },
  },
}
