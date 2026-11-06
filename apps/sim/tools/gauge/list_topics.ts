import { TOPIC_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeListTopicsParams,
  GaugeListTopicsResponse,
  GaugeTopicList,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeListTopicsTool: ToolConfig<GaugeListTopicsParams, GaugeListTopicsResponse> = {
  id: 'gauge_list_topics',
  name: 'Gauge List Topics',
  description: 'List one page of tracked-prompt topics in a category.',
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
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/topics`,
        { cursor: params.cursor, limit: params.limit }
      ),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeTopicList
    return {
      success: true,
      output: {
        topics: (data.data ?? []).map((item) => ({
          id: item.id,
          slug: item.slug,
          title: item.title,
          promptCount: item.promptCount,
          createdAt: item.createdAt,
        })),
        nextCursor: data.nextCursor ?? null,
      },
    }
  },
  outputs: {
    topics: {
      type: 'array',
      items: { type: 'object', properties: TOPIC_PROPERTIES },
      description: 'Topics',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for the next page; null when complete',
      nullable: true,
      optional: true,
    },
  },
}
