import { TAG_PROPERTIES } from '@/tools/gauge/outputs'
import type { GaugeCreateTagParams, GaugeCreateTagResponse, GaugeTag } from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeCreateTagTool: ToolConfig<GaugeCreateTagParams, GaugeCreateTagResponse> = {
  id: 'gauge_create_tag',
  name: 'Gauge Create Tag',
  description: 'Create an organization-wide prompt tag.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tag name (1–120 characters)',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tag color string (up to 20 characters)',
    },
  },
  request: {
    url: (params) => buildGaugeUrl(`/orgs/${safeUrlPathSegment(params.org, 'org')}/tags`),
    method: 'POST',
    headers: (params) => gaugeHeaders(params.accessToken, true),
    body: (params) => ({ name: params.name, color: params.color }),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeTag
    return {
      success: true,
      output: {
        tag: { id: data.id, name: data.name, color: data.color, promptCount: data.promptCount },
      },
    }
  },
  outputs: {
    tag: { type: 'json', properties: TAG_PROPERTIES, description: 'Tag' },
  },
}
