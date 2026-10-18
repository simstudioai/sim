import type {
  CloudflarePurgeCacheParams,
  CloudflarePurgeCacheResponse,
} from '@/tools/cloudflare/types'
import { parseCsvParam, parseJsonArrayParam } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
        description:
          'Comma-separated URLs or a JSON array of URL strings and {url, headers} objects. Use headers for custom cache keys, for example [{"url":"https://example.com/a","headers":{"CF-IPCountry":"US"}}]',
      },
      tags: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated list of cache tags to purge',
      },
      hosts: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated list of hostnames to purge',
      },
      prefixes: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated list of URL prefixes to purge',
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
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/purge_cache`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown[]> = {}
        const files =
          Array.isArray(params.files) ||
          (typeof params.files === 'string' && params.files.trim().startsWith('['))
            ? parseJsonArrayParam(params.files, 'Files')
            : parseCsvParam(params.files)
        if (files?.length) body.files = files
        for (const field of ['tags', 'hosts', 'prefixes'] as const) {
          const values = parseCsvParam(params[field])
          if (values?.length) body[field] = values
        }

        const targets = Object.keys(body)

        /**
         * `purge_everything` wipes the zone's entire cache, so a request that
         * also names specific targets is ambiguous about what the caller wanted.
         * Erroring is safer than silently discarding the target list and purging
         * everything anyway.
         */
        if (params.purge_everything) {
          if (targets.length > 0) {
            throw new Error(
              `purge_everything purges the entire zone cache and cannot be combined with specific targets, but ${targets.join(' and ')} were also provided. Set purge_everything to false to purge only those targets.`
            )
          }
          return { purge_everything: true }
        }

        if (targets.length === 0) {
          throw new Error(
            'No purge targets specified. Provide at least one of: files, tags, hosts, or prefixes, or set purge_everything to true.'
          )
        }

        /**
         * Cloudflare's purge request body is an `anyOf` over the target kinds and
         * no Cloudflare page documents whether mixing them is supported. Sim
         * refuses the combination conservatively so the caller gets a named error
         * instead of a generic 400.
         * https://developers.cloudflare.com/api/resources/cache/methods/purge/
         */
        if (targets.length > 1) {
          throw new Error(
            `Only one purge target kind is allowed per request, but ${targets.join(' and ')} were provided. Run a separate purge for each.`
          )
        }

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok || data.success !== true) {
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
