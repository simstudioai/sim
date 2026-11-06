import { PROMPT_OUT_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeListPromptsParams,
  GaugeListPromptsResponse,
  GaugePromptList,
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

export const gaugeListPromptsTool: ToolConfig<GaugeListPromptsParams, GaugeListPromptsResponse> = {
  id: 'gauge_list_prompts',
  name: 'Gauge List Prompts',
  description:
    'List one page of tracked prompts with optional topic, tag, and tracking-type filters.',
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
    topic: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by a single topic ID',
    },
    tag: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of tag IDs',
    },
    trackingType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prompt tracking type: visibility or branded_own or all',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque nextCursor from the previous page',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results to return (1–200; defaults to 50)',
    },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/prompts`,
        {
          topic: params.topic,
          tag: parseGaugeStringArray(params.tag, 'tag'),
          trackingType: params.trackingType,
          cursor: params.cursor,
          limit: params.limit,
        }
      ),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugePromptList
    return {
      success: true,
      output: {
        prompts: (data.data ?? []).map((item) => ({
          id: item.id,
          text: item.text,
          topicId: item.topicId ?? null,
          trackingType: item.trackingType,
          tagIds: item.tagIds ?? [],
          createdAt: item.createdAt,
          firstAnswerDay: item.firstAnswerDay ?? null,
        })),
        nextCursor: data.nextCursor ?? null,
      },
    }
  },
  outputs: {
    prompts: {
      type: 'array',
      items: { type: 'object', properties: PROMPT_OUT_PROPERTIES },
      description: 'Prompts',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for the next page; null when complete',
      nullable: true,
      optional: true,
    },
  },
}
