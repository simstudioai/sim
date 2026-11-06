import { ANSWER_DETAIL_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeAnswerDetail,
  GaugeGetAnswerParams,
  GaugeGetAnswerResponse,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeGetAnswerTool: ToolConfig<GaugeGetAnswerParams, GaugeGetAnswerResponse> = {
  id: 'gauge_get_answer',
  name: 'Gauge Get Answer',
  description: 'Read an AI answer with its prompt, brand mentions, source citations, and searches.',
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
    answerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Answer ID',
    },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/answers/${safeUrlPathSegment(params.answerId, 'answerId')}`
      ),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeAnswerDetail
    return {
      success: true,
      output: {
        answer: {
          id: data.id,
          promptId: data.promptId,
          promptText: data.promptText,
          topicId: data.topicId ?? null,
          model: data.model,
          day: data.day,
          createdAt: data.createdAt,
          text: data.text,
          mentions: (data.mentions ?? []).map((item) => ({
            brandId: item.brandId,
            name: item.name,
            mentionTypes: item.mentionTypes ?? [],
            count: item.count,
          })),
          citations: (data.citations ?? []).map((item) => ({
            pageId: item.pageId,
            url: item.url,
            title: item.title ?? null,
            domain: item.domain,
          })),
          searchQueries: data.searchQueries ?? [],
        },
      },
    }
  },
  outputs: {
    answer: { type: 'json', properties: ANSWER_DETAIL_PROPERTIES, description: 'Answer' },
  },
}
