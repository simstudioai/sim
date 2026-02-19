import type {
  CloudflarePurgeCacheParams,
  CloudflarePurgeCacheResponse,
} from '@/tools/cloudflare/types'
import type { ToolConfig } from '@/tools/types'

export const purgeCacheTool: ToolConfig<CloudflarePurgeCacheParams, CloudflarePurgeCacheResponse> =
  {
    id: 'cloudflare_purge_cache',
    name: 'Cloudflare Purge Cache',
    description:
      'Purges cached content for a zone. Can purge everything or specific files/tags/hosts/prefixes.',
    version: '1.0.0',

    params: {
      zoneId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The zone ID to purge cache for',
      },
      purge_everything: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Set to true to purge all cached content. Mutually exclusive with files, tags, hosts, and prefixes',
      },
      files: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated list of URLs to purge from cache',
      },
      tags: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated list of cache tags to purge (Enterprise only)',
      },
      hosts: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated list of hostnames to purge (Enterprise only)',
      },
      prefixes: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated list of URL prefixes to purge (Enterprise only)',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Cloudflare API Token',
      },
    },

    request: {
      url: (params) => `https://api.cloudflare.com/client/v4/zones/${params.zoneId}/purge_cache`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        if (params.purge_everything) {
          return { purge_everything: true }
        }

        const body: Record<string, string[]> = {}
        if (params.files) {
          const fileList = String(params.files)
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean)
          if (fileList.length > 0) body.files = fileList
        }
        if (params.tags) {
          const tagList = String(params.tags)
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
          if (tagList.length > 0) body.tags = tagList
        }
        if (params.hosts) {
          const hostList = String(params.hosts)
            .split(',')
            .map((h) => h.trim())
            .filter(Boolean)
          if (hostList.length > 0) body.hosts = hostList
        }
        if (params.prefixes) {
          const prefixList = String(params.prefixes)
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
          if (prefixList.length > 0) body.prefixes = prefixList
        }

        if (Object.keys(body).length === 0) {
          throw new Error(
            'No purge targets specified. Provide at least one of: files, tags, hosts, or prefixes, or set purge_everything to true.'
          )
        }

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.success) {
        return {
          success: false,
          output: { id: '' },
          error: data.errors?.[0]?.message ?? 'Failed to purge cache',
        }
      }

      return {
        success: true,
        output: {
          id: data.result?.id ?? '',
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Purge request identifier returned by Cloudflare' },
    },
  }
