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
        description:
          'Zone type: "full" (Cloudflare manages DNS), "partial" (CNAME setup), or "secondary" (secondary DNS)',
      },
      jump_start: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Automatically attempt to fetch existing DNS records when creating the zone',
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
        if (params.jump_start !== undefined) body.jump_start = params.jump_start
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
            activated_on: '',
            development_mode: 0,
            plan: {
              id: '',
              name: '',
              price: 0,
              is_subscribed: false,
              frequency: '',
              currency: '',
              legacy_id: '',
            },
            account: { id: '', name: '' },
            owner: { id: '', name: '', type: '' },
            meta: {
              cdn_only: false,
              custom_certificate_quota: 0,
              dns_only: false,
              foundation_dns: false,
              page_rule_quota: 0,
              phishing_detected: false,
              step: 0,
            },
            vanity_name_servers: [],
            permissions: [],
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
          activated_on: zone?.activated_on ?? '',
          development_mode: zone?.development_mode ?? 0,
          plan: {
            id: zone?.plan?.id ?? '',
            name: zone?.plan?.name ?? '',
            price: zone?.plan?.price ?? 0,
            is_subscribed: zone?.plan?.is_subscribed ?? false,
            frequency: zone?.plan?.frequency ?? '',
            currency: zone?.plan?.currency ?? '',
            legacy_id: zone?.plan?.legacy_id ?? '',
          },
          account: {
            id: zone?.account?.id ?? '',
            name: zone?.account?.name ?? '',
          },
          owner: {
            id: zone?.owner?.id ?? '',
            name: zone?.owner?.name ?? '',
            type: zone?.owner?.type ?? '',
          },
          meta: {
            cdn_only: zone?.meta?.cdn_only ?? false,
            custom_certificate_quota: zone?.meta?.custom_certificate_quota ?? 0,
            dns_only: zone?.meta?.dns_only ?? false,
            foundation_dns: zone?.meta?.foundation_dns ?? false,
            page_rule_quota: zone?.meta?.page_rule_quota ?? 0,
            phishing_detected: zone?.meta?.phishing_detected ?? false,
            step: zone?.meta?.step ?? 0,
          },
          vanity_name_servers: zone?.vanity_name_servers ?? [],
          permissions: zone?.permissions ?? [],
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Created zone ID' },
      name: { type: 'string', description: 'Domain name' },
      status: {
        type: 'string',
        description: 'Zone status (initializing, pending, active, moved)',
      },
      paused: { type: 'boolean', description: 'Whether the zone is paused' },
      type: { type: 'string', description: 'Zone type (full, partial, or secondary)' },
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
      activated_on: {
        type: 'string',
        description: 'ISO 8601 date when the zone was activated',
        optional: true,
      },
      development_mode: {
        type: 'number',
        description: 'Seconds remaining in development mode (0 = off)',
      },
      plan: {
        type: 'object',
        description: 'Zone plan information',
        properties: {
          id: { type: 'string', description: 'Plan identifier' },
          name: { type: 'string', description: 'Plan name' },
          price: { type: 'number', description: 'Plan price' },
          is_subscribed: {
            type: 'boolean',
            description: 'Whether the zone is subscribed to the plan',
          },
          frequency: { type: 'string', description: 'Plan billing frequency' },
          currency: { type: 'string', description: 'Plan currency' },
          legacy_id: { type: 'string', description: 'Legacy plan identifier' },
        },
      },
      account: {
        type: 'object',
        description: 'Account the zone belongs to',
        properties: {
          id: { type: 'string', description: 'Account identifier' },
          name: { type: 'string', description: 'Account name' },
        },
      },
      owner: {
        type: 'object',
        description: 'Zone owner information',
        properties: {
          id: { type: 'string', description: 'Owner identifier' },
          name: { type: 'string', description: 'Owner name' },
          type: { type: 'string', description: 'Owner type' },
        },
      },
      meta: {
        type: 'object',
        description: 'Zone metadata',
        properties: {
          cdn_only: { type: 'boolean', description: 'Whether the zone is CDN only' },
          custom_certificate_quota: { type: 'number', description: 'Custom certificate quota' },
          dns_only: { type: 'boolean', description: 'Whether the zone is DNS only' },
          foundation_dns: { type: 'boolean', description: 'Whether foundation DNS is enabled' },
          page_rule_quota: { type: 'number', description: 'Page rule quota' },
          phishing_detected: { type: 'boolean', description: 'Whether phishing was detected' },
          step: { type: 'number', description: 'Current setup step' },
        },
        optional: true,
      },
      vanity_name_servers: {
        type: 'array',
        description: 'Custom vanity name servers',
        items: { type: 'string', description: 'Vanity name server hostname' },
        optional: true,
      },
      permissions: {
        type: 'array',
        description: 'User permissions for the zone',
        items: { type: 'string', description: 'Permission string' },
        optional: true,
      },
    },
  }
