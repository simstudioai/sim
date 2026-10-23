import type {
  CloudflareDeleteWorkerScriptParams,
  CloudflareDeleteWorkerScriptResponse,
} from '@/tools/cloudflare/operation-types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteWorkerScriptTool: ToolConfig<
  CloudflareDeleteWorkerScriptParams,
  CloudflareDeleteWorkerScriptResponse
> = {
  id: 'cloudflare_delete_worker_script',
  name: 'Cloudflare Delete Worker Script',
  description: 'Delete your worker. This call has no response body on a successful delete.',
  version: '1.0.0',
  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account id',
    },
    scriptName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Script name',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
    force: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'If true, delete the Worker even when other Workers still reference it. Service bindings in those Workers may be left broken. Durable Object namespaces implemented by the deleted Worker are deleted even if other Workers reference them.',
    },
  },
  request: {
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/workers/scripts/${safeUrlPathSegment(params.scriptName, 'scriptName')}`
      )
      appendParam(url, 'force', params.force)
      return url.toString()
    },
    method: 'DELETE',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response, { allowEmptySuccess: true })
    const success = response.ok && data.success === true
    return {
      success,
      output: { success },
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to delete worker script') }
        : {}),
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Cloudflare accepted the operation' },
  },
}
