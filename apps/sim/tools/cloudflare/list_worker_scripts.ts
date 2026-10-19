import { RESULT_INFO_OUTPUTS, WORKER_SCRIPT_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListWorkerScriptsParams,
  CloudflareListWorkerScriptsResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
        `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/workers/scripts`
      )
      appendParam(url, 'tags', params.tags)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const raw = data.result
    const rows = Array.isArray(raw) ? raw : []
    const success = response.ok && data.success === true && Array.isArray(raw)
    return {
      success,
      output: {
        scripts: rows.map((row) => mapCloudflareFields(row, WORKER_SCRIPT_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
      },
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to list worker scripts') } : {}),
    }
  },
  outputs: {
    scripts: {
      type: 'array',
      description: 'Scripts',
      items: { type: 'object', properties: WORKER_SCRIPT_OUTPUTS },
    },
    total_count: {
      type: 'number',
      description:
        'Total matching resources, or the number of resources returned on this page when the API omits a total',
    },
    result_info: {
      type: 'json',
      description: 'Pagination metadata returned by Cloudflare',
      nullable: true,
      properties: RESULT_INFO_OUTPUTS,
    },
  },
}
