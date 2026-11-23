import { CITATION_ITEM_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeCitationList,
  GaugeListCitationsParams,
  GaugeListCitationsResponse,
} from '@/tools/gauge/types'
import {
  buildGaugeUrl,
  gaugeAuthParams,
  gaugeHeaders,
  gaugeOAuth,
  parseGaugeStringArray,
} from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeListCitationsTool: ToolConfig<
  GaugeListCitationsParams,
  GaugeListCitationsResponse
> = {
  id: 'gauge_list_citations',
  name: 'Gauge List Citations',
  description: 'List one page of sources cited by AI answers in a category.',
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
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date in YYYY-MM-DD format; defaults to 7 days ago',
    },
    until: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date in YYYY-MM-DD format; defaults to today',
    },
    model: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of model IDs',
    },
    prompt: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of prompt IDs',
    },
    topic: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of topic IDs',
    },
    tag: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of tag IDs',
    },
    trackingType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prompt tracking type: visibility or branded_own or all',
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
    domain: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of cited domains',
    },
    page: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of cited page IDs',
    },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/citations`,
        {
          since: params.since,
          until: params.until,
          model: parseGaugeStringArray(params.model, 'model'),
          prompt: parseGaugeStringArray(params.prompt, 'prompt'),
          topic: parseGaugeStringArray(params.topic, 'topic'),
          tag: parseGaugeStringArray(params.tag, 'tag'),
          trackingType: params.trackingType,
          cursor: params.cursor,
          limit: params.limit,
          domain: parseGaugeStringArray(params.domain, 'domain'),
          page: parseGaugeStringArray(params.page, 'page'),
        }
      ),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeCitationList
    return {
      success: true,
      output: {
        citations: (data.data ?? []).map((item) => ({
          answerId: item.answerId,
          pageId: item.pageId,
          promptId: item.promptId,
          model: item.model,
          day: item.day,
          domain: item.domain,
          url: item.url,
        })),
        nextCursor: data.nextCursor ?? null,
      },
    }
  },
  outputs: {
    citations: {
      type: 'array',
      items: { type: 'object', properties: CITATION_ITEM_PROPERTIES },
      description: 'Citations',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for the next page; null when complete',
      nullable: true,
      optional: true,
    },
  },
}
