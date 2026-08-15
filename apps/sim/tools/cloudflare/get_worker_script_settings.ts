import type {
  CloudflareGetWorkerScriptSettingsParams,
  CloudflareGetWorkerScriptSettingsResponse,
} from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const getWorkerScriptSettingsTool: ToolConfig<
  CloudflareGetWorkerScriptSettingsParams,
  CloudflareGetWorkerScriptSettingsResponse
> = {
  id: 'cloudflare_get_worker_script_settings',
  name: 'Cloudflare Get Worker Script Settings',
  description:
    'Reads the deployment settings of a single Workers script — bindings, compatibility date and flags, limits, observability, placement, and tail consumers. The plain "get script" endpoint in the Cloudflare API returns raw JavaScript source rather than JSON, so this settings endpoint is the structured way to inspect one script. Requires an API token with Account Workers Scripts Read.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Workers scripts are account-scoped',
    },
    scriptName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the Workers script to read settings for',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/workers/scripts/${encodeURIComponent(params.scriptName)}/settings`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          bindings: null,
          compatibility_date: null,
          compatibility_flags: null,
          limits: null,
          logpush: null,
          migrations: null,
          observability: null,
          placement: null,
          tags: null,
          tail_consumers: null,
          usage_model: null,
        },
        error: cloudflareErrorMessage(data, 'Failed to get Worker script settings'),
      }
    }

    const settings = data.result
    return {
      success: true,
      output: {
        bindings: settings?.bindings ?? null,
        compatibility_date: settings?.compatibility_date ?? null,
        compatibility_flags: settings?.compatibility_flags ?? null,
        limits: settings?.limits ?? null,
        logpush: settings?.logpush ?? null,
        migrations: settings?.migrations ?? null,
        observability: settings?.observability ?? null,
        placement: settings?.placement ?? null,
        tags: settings?.tags ?? null,
        tail_consumers: settings?.tail_consumers ?? null,
        usage_model: settings?.usage_model ?? null,
      },
    }
  },

  outputs: {
    bindings: {
      type: 'json',
      description: 'Resource bindings available to the script (KV, R2, D1, secrets, and more)',
      optional: true,
    },
    compatibility_date: {
      type: 'string',
      description: 'Workers runtime compatibility date',
      optional: true,
    },
    compatibility_flags: {
      type: 'array',
      description: 'Workers runtime compatibility flags',
      items: { type: 'string', description: 'Compatibility flag' },
      optional: true,
    },
    limits: { type: 'json', description: 'CPU and other execution limits', optional: true },
    logpush: { type: 'boolean', description: 'Whether Workers Logpush is enabled', optional: true },
    migrations: { type: 'json', description: 'Durable Object migrations', optional: true },
    observability: {
      type: 'json',
      description: 'Observability and log-sampling configuration',
      optional: true,
    },
    placement: { type: 'json', description: 'Smart placement configuration', optional: true },
    tags: {
      type: 'array',
      description: 'Tags attached to the script',
      items: { type: 'string', description: 'Tag name' },
      optional: true,
    },
    tail_consumers: {
      type: 'json',
      description: "Workers that consume this script's tail events",
      optional: true,
    },
    usage_model: {
      type: 'string',
      description: 'Billing usage model',
      optional: true,
    },
  },
}
