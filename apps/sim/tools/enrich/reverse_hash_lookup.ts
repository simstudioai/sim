import type {
  EnrichReverseHashLookupParams,
  EnrichReverseHashLookupResponse,
} from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const reverseHashLookupTool: ToolConfig<
  EnrichReverseHashLookupParams,
  EnrichReverseHashLookupResponse
> = {
  id: 'enrich_reverse_hash_lookup',
  name: 'Enrich Reverse Hash Lookup',
  description: 'Convert an MD5 email hash back to the original email address and display name.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    hash: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'MD5 hash value to look up',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/reverse-hash-lookup')
      url.searchParams.append('hash', params.hash.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const resultData = data.data ?? {}

    return {
      success: true,
      output: {
        hash: resultData.hash ?? '',
        email: resultData.email ?? null,
        displayName: resultData.display_name ?? null,
        found: !!resultData.email,
      },
    }
  },

  outputs: {
    hash: {
      type: 'string',
      description: 'MD5 hash that was looked up',
    },
    email: {
      type: 'string',
      description: 'Original email address',
      optional: true,
    },
    displayName: {
      type: 'string',
      description: 'Display name associated with the email',
      optional: true,
    },
    found: {
      type: 'boolean',
      description: 'Whether an email was found for the hash',
    },
  },
}
