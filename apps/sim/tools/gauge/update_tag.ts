import { TAG_PROPERTIES } from '@/tools/gauge/outputs'
import type { GaugeTag, GaugeUpdateTagParams, GaugeUpdateTagResponse } from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeUpdateTagTool: ToolConfig<GaugeUpdateTagParams, GaugeUpdateTagResponse> = {
  id: 'gauge_update_tag',
  name: 'Gauge Update Tag',
  description: 'Change the name or color of a prompt tag.',
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
    tagId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Tag ID' },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tag name (1–120 characters)',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tag color string (up to 20 characters); omit to keep unchanged or use "" to clear',
    },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/tags/${safeUrlPathSegment(params.tagId, 'tagId')}`
      ),
    method: 'PATCH',
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
