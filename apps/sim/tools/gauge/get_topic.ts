import { TOPIC_PROPERTIES } from '@/tools/gauge/outputs'
import type { GaugeGetTopicParams, GaugeGetTopicResponse, GaugeTopic } from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeGetTopicTool: ToolConfig<GaugeGetTopicParams, GaugeGetTopicResponse> = {
  id: 'gauge_get_topic',
  name: 'Gauge Get Topic',
  description: 'Read a topic and its tracked-prompt count.',
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
    topicId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Topic ID' },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/topics/${safeUrlPathSegment(params.topicId, 'topicId')}`
      ),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeTopic
    return {
      success: true,
      output: {
        topic: {
          id: data.id,
          slug: data.slug,
          title: data.title,
          promptCount: data.promptCount,
          createdAt: data.createdAt,
        },
      },
    }
  },
  outputs: {
    topic: { type: 'json', properties: TOPIC_PROPERTIES, description: 'Topic' },
  },
}
