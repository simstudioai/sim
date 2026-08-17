import type {
  CloudflareListWorkerScriptsParams,
  CloudflareListWorkerScriptsResponse,
  CloudflareRawWorkerScript,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const listWorkerScriptsTool: ToolConfig<
  CloudflareListWorkerScriptsParams,
  CloudflareListWorkerScriptsResponse
> = {
  id: 'cloudflare_list_worker_scripts',
  name: 'Cloudflare List Worker Scripts',
  description:
    'Lists the Workers scripts deployed in an account. Requires an API token with Account Workers Scripts Read.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Workers scripts are account-scoped',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter scripts by tag. Cloudflare expects a comma-separated list of tag:allowed pairs where allowed is yes or no, e.g. team:core:yes,deprecated:no',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/workers/scripts`
      )
      appendParam(url, 'tags', params.tags)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse<CloudflareRawWorkerScript[]>(response)

    if (!data.success) {
      return {
        success: false,
        output: { scripts: [], total_count: 0 },
        error: cloudflareErrorMessage(data, 'Failed to list Worker scripts'),
      }
    }

    const scripts = Array.isArray(data.result) ? data.result : []

    return {
      success: true,
      output: {
        scripts: scripts.map((script) => ({
          id: script.id ?? '',
          tag: script.tag ?? null,
          etag: script.etag ?? null,
          created_on: script.created_on ?? null,
          modified_on: script.modified_on ?? null,
          usage_model: script.usage_model ?? null,
          placement_mode: script.placement_mode ?? null,
          logpush: script.logpush ?? null,
          has_assets: script.has_assets ?? null,
          has_modules: script.has_modules ?? null,
          compatibility_date: script.compatibility_date ?? null,
          compatibility_flags: script.compatibility_flags ?? null,
          routes: script.routes ?? null,
          tail_consumers: script.tail_consumers ?? null,
        })),
        total_count: scripts.length,
      },
    }
  },

  outputs: {
    scripts: {
      type: 'array',
      description: 'Workers scripts in the account',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Script name' },
          tag: {
            type: 'string',
            description: 'Immutable script identifier, distinct from the script name',
            optional: true,
          },
          etag: { type: 'string', description: 'Hash of the script content', optional: true },
          created_on: { type: 'string', description: 'Creation timestamp', optional: true },
          modified_on: { type: 'string', description: 'Last deployment timestamp', optional: true },
          usage_model: {
            type: 'string',
            description: 'Billing usage model (standard, bundled, or unbound)',
            optional: true,
          },
          placement_mode: {
            type: 'string',
            description: 'Smart placement mode (smart or targeted)',
            optional: true,
          },
          logpush: {
            type: 'boolean',
            description: 'Whether Workers Logpush is enabled',
            optional: true,
          },
          has_assets: {
            type: 'boolean',
            description: 'Whether the script ships static assets',
            optional: true,
          },
          has_modules: {
            type: 'boolean',
            description: 'Whether the script uses ES modules',
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
          routes: { type: 'json', description: 'Routes the script is bound to', optional: true },
          tail_consumers: {
            type: 'json',
            description: "Workers that consume this script's tail events",
            optional: true,
          },
        },
      },
    },
    total_count: { type: 'number', description: 'Number of scripts returned' },
  },
}
