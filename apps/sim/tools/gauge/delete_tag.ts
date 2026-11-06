import type { GaugeDeleteTagParams, GaugeDeleteTagResponse } from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeDeleteTagTool: ToolConfig<GaugeDeleteTagParams, GaugeDeleteTagResponse> = {
  id: 'gauge_delete_tag',
  name: 'Gauge Delete Tag',
  description: 'Delete a prompt tag and remove its associations with prompts.',
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
    method: 'DELETE',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (_response, params) => {
    if (!params) throw new Error('Gauge delete tag requires request context')
    return { success: true, output: { tagId: params.tagId.trim(), deleted: true } }
  },
  outputs: {
    tagId: { type: 'string', description: 'ID of the deleted tag' },
    deleted: { type: 'boolean', description: 'Whether the tag was deleted' },
  },
}
