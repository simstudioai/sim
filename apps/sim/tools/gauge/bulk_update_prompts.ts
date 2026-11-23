import type {
  GaugeBulkPatchOut,
  GaugeBulkUpdatePromptsParams,
  GaugeBulkUpdatePromptsResponse,
} from '@/tools/gauge/types'
import {
  buildGaugeUrl,
  gaugeAuthParams,
  gaugeHeaders,
  gaugeOAuth,
  parseGaugeStringArray,
} from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeBulkUpdatePromptsTool: ToolConfig<
  GaugeBulkUpdatePromptsParams,
  GaugeBulkUpdatePromptsResponse
> = {
  id: 'gauge_bulk_update_prompts',
  name: 'Gauge Bulk Update Prompts',
  description: 'Change the topic or tracking type of up to 500 tracked prompts.',
  version: '1.0.0',
  oauth: gaugeOAuth,
  params: {
    ...gaugeAuthParams,
    org: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Organization slug or UUID',
    },
    category: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Category slug or cat_ ID',
    },
    topicId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New topic ID; omitted values leave the topic unchanged',
    },
    trackingType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prompt tracking type: visibility or branded_own',
    },
    ids: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of 1–500 prompt IDs to update',
    },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/prompts`
      ),
    method: 'PATCH',
    headers: (params) => gaugeHeaders(params.accessToken, true),
    body: (params) => ({
      topicId: params.topicId,
      trackingType: params.trackingType,
      ids: parseGaugeStringArray(params.ids, 'ids', { min: 1, max: 500 }),
    }),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeBulkPatchOut
    return { success: true, output: { updated: data.updated ?? [], notFound: data.notFound ?? [] } }
  },
  outputs: {
    updated: { type: 'array', items: { type: 'string' }, description: 'Updated' },
    notFound: { type: 'array', items: { type: 'string' }, description: 'Not found' },
  },
}
