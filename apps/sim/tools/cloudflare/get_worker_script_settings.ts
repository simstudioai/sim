import { isRecordLike } from '@sim/utils/object'
import { WORKER_SETTINGS_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareGetWorkerScriptSettingsParams,
  CloudflareGetWorkerScriptSettingsResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/workers/scripts/${safeUrlPathSegment(params.scriptName, 'scriptName')}/settings`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, WORKER_SETTINGS_OUTPUTS),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to get worker script settings') }
        : {}),
    }
  },
  outputs: WORKER_SETTINGS_OUTPUTS,
}
