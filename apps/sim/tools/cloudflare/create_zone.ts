import type {
  CloudflareCreateZoneParams,
  CloudflareCreateZoneResponse,
} from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'

export const createZoneTool: ToolConfig<CloudflareCreateZoneParams, CloudflareCreateZoneResponse> =
  {
    id: 'cloudflare_create_zone',
    name: 'Cloudflare Create Zone',
    description: 'Adds a new zone (domain) to the Cloudflare account.',
    version: '1.0.0',

    params: {
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The domain name to add (e.g., "example.com")',
      },
      accountId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The Cloudflare account ID',
      },
      type: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Zone type: "full" (Cloudflare manages DNS) or "partial" (CNAME setup)',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Cloudflare API Token',
      },
    },

    request: {
      url: 'https://api.cloudflare.com/client/v4/zones',
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, any> = {
          name: params.name,
          account: { id: params.accountId },
        }
        if (params.type) body.type = params.type
        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.success) {
        return {
          success: false,
          output: {
            id: '',
            name: '',
            status: '',
            paused: false,
            type: '',
            name_servers: [],
            original_name_servers: [],
            created_on: '',
            modified_on: '',
            plan: { id: '', name: '' },
          },
          error: data.errors?.[0]?.message ?? 'Failed to create zone',
        }
      }

      const zone = data.result
      return {
        success: true,
        output: {
          id: zone?.id ?? '',
          name: zone?.name ?? '',
          status: zone?.status ?? '',
          paused: zone?.paused ?? false,
          type: zone?.type ?? '',
          name_servers: zone?.name_servers ?? [],
          original_name_servers: zone?.original_name_servers ?? [],
          created_on: zone?.created_on ?? '',
          modified_on: zone?.modified_on ?? '',
          plan: {
            id: zone?.plan?.id ?? '',
            name: zone?.plan?.name ?? '',
          },
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Created zone ID' },
      name: { type: 'string', description: 'Domain name' },
      status: {
        type: 'string',
        description: 'Zone status (active, pending, initializing, moved, deleted, deactivated)',
      },
      paused: { type: 'boolean', description: 'Whether the zone is paused' },
      type: { type: 'string', description: 'Zone type (full or partial)' },
      name_servers: {
        type: 'array',
        description: 'Assigned Cloudflare name servers',
        items: { type: 'string', description: 'Name server hostname' },
      },
      original_name_servers: {
        type: 'array',
        description: 'Original name servers before moving to Cloudflare',
        items: { type: 'string', description: 'Name server hostname' },
        optional: true,
      },
      created_on: { type: 'string', description: 'ISO 8601 date when the zone was created' },
      modified_on: {
        type: 'string',
        description: 'ISO 8601 date when the zone was last modified',
      },
      plan: {
        type: 'object',
        description: 'Zone plan information',
        properties: {
          id: { type: 'string', description: 'Plan identifier' },
          name: { type: 'string', description: 'Plan name' },
        },
      },
    },
  }
