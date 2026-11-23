import { ANSWER_ITEM_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeAnswerList,
  GaugeListAnswersParams,
  GaugeListAnswersResponse,
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

export const gaugeListAnswersTool: ToolConfig<GaugeListAnswersParams, GaugeListAnswersResponse> = {
  id: 'gauge_list_answers',
  name: 'Gauge List Answers',
  description:
    'List one page of collected AI answers using date, model, prompt, and brand filters.',
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
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date in YYYY-MM-DD format; defaults to 7 days ago',
    },
    until: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date in YYYY-MM-DD format; defaults to today',
    },
    model: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of model IDs',
    },
    prompt: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of prompt IDs',
    },
    topic: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of topic IDs',
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
      description: 'Maximum results to return (1–100; defaults to 50)',
    },
    brand: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of brand IDs that an answer must mention',
    },
    brandAbsent: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of brand IDs that an answer must not mention',
    },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/answers`,
        {
          since: params.since,
          until: params.until,
          model: parseGaugeStringArray(params.model, 'model'),
          prompt: parseGaugeStringArray(params.prompt, 'prompt'),
          topic: parseGaugeStringArray(params.topic, 'topic'),
          tag: parseGaugeStringArray(params.tag, 'tag'),
          trackingType: params.trackingType,
          cursor: params.cursor,
          limit: params.limit,
          brand: parseGaugeStringArray(params.brand, 'brand'),
          brandAbsent: parseGaugeStringArray(params.brandAbsent, 'brandAbsent'),
        }
      ),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeAnswerList
    return {
      success: true,
      output: {
        answers: (data.data ?? []).map((item) => ({
          id: item.id,
          promptId: item.promptId,
          topicId: item.topicId ?? null,
          model: item.model,
          day: item.day,
          createdAt: item.createdAt,
          text: item.text,
          brandIds: item.brandIds ?? [],
        })),
        nextCursor: data.nextCursor ?? null,
      },
    }
  },
  outputs: {
    answers: {
      type: 'array',
      items: { type: 'object', properties: ANSWER_ITEM_PROPERTIES },
      description: 'Answers',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for the next page; null when complete',
      nullable: true,
      optional: true,
    },
  },
}
