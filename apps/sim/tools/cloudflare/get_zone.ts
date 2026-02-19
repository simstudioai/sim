import type { CloudflareGetZoneParams, CloudflareGetZoneResponse } from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'

export const getZoneTool: ToolConfig<CloudflareGetZoneParams, CloudflareGetZoneResponse> = {
  id: 'cloudflare_get_zone',
  name: 'Cloudflare Get Zone',
  description: 'Gets details for a specific zone (domain) by its ID.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to retrieve details for',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => `https://api.cloudflare.com/client/v4/zones/${params.zoneId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
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
        error: data.errors?.[0]?.message ?? 'Failed to get zone',
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
    id: { type: 'string', description: 'Zone ID' },
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
    modified_on: { type: 'string', description: 'ISO 8601 date when the zone was last modified' },
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
