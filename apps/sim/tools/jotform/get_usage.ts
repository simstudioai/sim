import { unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformGetUsageParams, JotformGetUsageResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  toStringOrNull,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const getUsageTool: ToolConfig<JotformGetUsageParams, JotformGetUsageResponse> = {
  id: 'jotform_get_usage',
  name: 'Jotform Get Usage',
  description:
    'Get this month usage for the account: submissions received, payments, form views, upload space, and API calls made today.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform API key',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Jotform data residency region the API key belongs to: "us" (default), "eu", or "hipaa"',
    },
  },

  request: {
    url: (params) => buildJotformUrl(params, 'user/usage').toString(),
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Get Usage')
    const raw = unwrapSingle(envelope.content) ?? {}

    return {
      success: true,
      output: {
        usage: {
          submissions: toStringOrNull(raw.submissions),
          ssl_submissions: toStringOrNull(raw.ssl_submissions),
          payments: toStringOrNull(raw.payments),
          uploads: toStringOrNull(raw.uploads),
          mobile_submissions: toStringOrNull(raw.mobile_submissions),
          views: toStringOrNull(raw.views),
          api: toStringOrNull(raw.api),
        },
      },
    }
  },

  outputs: {
    usage: {
      type: 'object',
      description: 'Usage counters for the current month',
      properties: {
        submissions: { type: 'string', description: 'Submissions received this month' },
        ssl_submissions: { type: 'string', description: 'Secure submissions received this month' },
        payments: { type: 'string', description: 'Payment submissions received this month' },
        uploads: { type: 'string', description: 'Disk space used by uploaded files, in bytes' },
        mobile_submissions: {
          type: 'string',
          description: 'Mobile submissions received this month',
        },
        views: { type: 'string', description: 'Form views received this month' },
        api: { type: 'string', description: 'API calls made today' },
      },
    },
  },
}
