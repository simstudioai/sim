import type {
  GaugePromptTagsOut,
  GaugeRemoveTagsFromPromptsParams,
  GaugeRemoveTagsFromPromptsResponse,
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

export const gaugeRemoveTagsFromPromptsTool: ToolConfig<
  GaugeRemoveTagsFromPromptsParams,
  GaugeRemoveTagsFromPromptsResponse
> = {
  id: 'gauge_remove_tags_from_prompts',
  name: 'Gauge Remove Tags From Prompts',
  description: 'Remove a set of tags from the selected tracked prompts.',
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
    promptIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of 1–500 prompt IDs',
    },
    tagIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of 1–50 tag IDs',
    },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/prompts/tags`
      ),
    method: 'DELETE',
    headers: (params) => gaugeHeaders(params.accessToken, true),
    body: (params) => ({
      promptIds: parseGaugeStringArray(params.promptIds, 'promptIds', { min: 1, max: 500 }),
      tagIds: parseGaugeStringArray(params.tagIds, 'tagIds', { min: 1, max: 50 }),
    }),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugePromptTagsOut
    return { success: true, output: { promptIds: data.promptIds ?? [] } }
  },
  outputs: {
    promptIds: { type: 'array', items: { type: 'string' }, description: 'Prompt ids' },
  },
}
