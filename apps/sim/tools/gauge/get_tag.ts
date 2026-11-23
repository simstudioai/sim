import { TAG_PROPERTIES } from '@/tools/gauge/outputs'
import type { GaugeGetTagParams, GaugeGetTagResponse, GaugeTag } from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeGetTagTool: ToolConfig<GaugeGetTagParams, GaugeGetTagResponse> = {
  id: 'gauge_get_tag',
  name: 'Gauge Get Tag',
  description: 'Read a prompt tag and its usage count.',
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
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/tags/${safeUrlPathSegment(params.tagId, 'tagId')}`
      ),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
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
