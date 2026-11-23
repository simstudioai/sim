import { CATEGORY_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeCategoryList,
  GaugeListCategoriesParams,
  GaugeListCategoriesResponse,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeListCategoriesTool: ToolConfig<
  GaugeListCategoriesParams,
  GaugeListCategoriesResponse
> = {
  id: 'gauge_list_categories',
  name: 'Gauge List Categories',
  description: 'List the AI-search categories configured for an organization.',
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
    url: (params) => buildGaugeUrl(`/orgs/${safeUrlPathSegment(params.org, 'org')}/categories`),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeCategoryList
    return {
      success: true,
      output: {
        categories: (data.data ?? []).map((item) => ({
          id: item.id,
          slug: item.slug,
          name: item.name,
          description: item.description,
        })),
        nextCursor: data.nextCursor ?? null,
      },
    }
  },
  outputs: {
    categories: {
      type: 'array',
      items: { type: 'object', properties: CATEGORY_PROPERTIES },
      description: 'Categories',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for the next page; null when complete',
      nullable: true,
      optional: true,
    },
  },
}
