import type {
  MintlifyGetPageContentParams,
  MintlifyGetPageContentResponse,
} from '@/tools/mintlify/types'
import {
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableString,
  toStringArray,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

export const mintlifyGetPageContentTool: ToolConfig<
  MintlifyGetPageContentParams,
  MintlifyGetPageContentResponse
> = {
  id: 'mintlify_get_page_content',
  name: 'Mintlify Get Page Content',
  description:
    'Retrieve the full text content of a Mintlify documentation page by its path. Use it after a search to fetch the complete page.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Domain identifier from your domain.mintlify.site URL, found at the end of your dashboard URL',
    },
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Page slug or path to retrieve, matching the path field returned by Search Documentation',
    },
    groups: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documentation groups the caller is authorized to access, as a JSON array of strings. Only applies to deployments using auth or userAuth.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify assistant API key (starts with mint_dsc_)',
    },
  },

  request: {
    url: (params) => `${MINTLIFY_API_BASE}/discovery/v1/page/${pathSegment(params.domain)}`,
    method: 'POST',
    headers: (params) => mintlifyHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { path: params.path }
      const groups = toStringArray(params.groups)
      if (groups) body.groups = groups
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to get Mintlify page content')

    return {
      success: true,
      output: {
        path: toNullableString(data.path),
        content: toNullableString(data.content),
      },
    }
  },

  outputs: {
    path: { type: 'string', description: 'The page path that was requested', nullable: true },
    content: { type: 'string', description: 'Full text content of the page', nullable: true },
  },
}
