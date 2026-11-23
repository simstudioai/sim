import { PROMPT_OUT_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeGetPromptParams,
  GaugeGetPromptResponse,
  GaugePromptOut,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeGetPromptTool: ToolConfig<GaugeGetPromptParams, GaugeGetPromptResponse> = {
  id: 'gauge_get_prompt',
  name: 'Gauge Get Prompt',
  description: 'Read a tracked question and its topic, tags, and sampling information.',
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
    promptId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Prompt ID',
    },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/prompts/${safeUrlPathSegment(params.promptId, 'promptId')}`
      ),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugePromptOut
    return {
      success: true,
      output: {
        prompt: {
          id: data.id,
          text: data.text,
          topicId: data.topicId ?? null,
          trackingType: data.trackingType,
          tagIds: data.tagIds ?? [],
          createdAt: data.createdAt,
          firstAnswerDay: data.firstAnswerDay ?? null,
        },
      },
    }
  },
  outputs: {
    prompt: { type: 'json', properties: PROMPT_OUT_PROPERTIES, description: 'Prompt' },
  },
}
