import { PROMPT_OUT_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugePromptOut,
  GaugeUpdatePromptParams,
  GaugeUpdatePromptResponse,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeUpdatePromptTool: ToolConfig<GaugeUpdatePromptParams, GaugeUpdatePromptResponse> =
  {
    id: 'gauge_update_prompt',
    name: 'Gauge Update Prompt',
    description:
      'Move a prompt to another topic or change its tracking type. Prompt text is immutable: create a new prompt instead.',
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
    },
    request: {
      url: (params) =>
        buildGaugeUrl(
          `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/prompts/${safeUrlPathSegment(params.promptId, 'promptId')}`
        ),
      method: 'PATCH',
      headers: (params) => gaugeHeaders(params.accessToken, true),
      body: (params) => ({ topicId: params.topicId, trackingType: params.trackingType }),
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
