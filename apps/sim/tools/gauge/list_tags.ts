import { TAG_PROPERTIES } from '@/tools/gauge/outputs'
import type { GaugeListTagsParams, GaugeListTagsResponse, GaugeTagList } from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeListTagsTool: ToolConfig<GaugeListTagsParams, GaugeListTagsResponse> = {
  id: 'gauge_list_tags',
  name: 'Gauge List Tags',
  description: 'List the tags available to organize prompts in an organization.',
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
  },
  request: {
    url: (params) => buildGaugeUrl(`/orgs/${safeUrlPathSegment(params.org, 'org')}/tags`),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeTagList
    return {
      success: true,
      output: {
        tags: (data.data ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          color: item.color,
          promptCount: item.promptCount,
        })),
        nextCursor: data.nextCursor ?? null,
      },
    }
  },
  outputs: {
    tags: {
      type: 'array',
      items: { type: 'object', properties: TAG_PROPERTIES },
      description: 'Tags',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for the next page; null when complete',
      nullable: true,
      optional: true,
    },
  },
}
