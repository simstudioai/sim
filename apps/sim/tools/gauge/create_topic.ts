import { TOPIC_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeCreateTopicParams,
  GaugeCreateTopicResponse,
  GaugeTopic,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeCreateTopicTool: ToolConfig<GaugeCreateTopicParams, GaugeCreateTopicResponse> = {
  id: 'gauge_create_topic',
  name: 'Gauge Create Topic',
  description: 'Create a topic to organize tracked prompts.',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Topic title (1–200 characters)',
    },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/topics`
      ),
    method: 'POST',
    headers: (params) => gaugeHeaders(params.accessToken, true),
    body: (params) => ({ title: params.title }),
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
