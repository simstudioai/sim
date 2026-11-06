import { BRAND_OUT_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeBrandList,
  GaugeListBrandsParams,
  GaugeListBrandsResponse,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeListBrandsTool: ToolConfig<GaugeListBrandsParams, GaugeListBrandsResponse> = {
  id: 'gauge_list_brands',
  name: 'Gauge List Brands',
  description:
    "Your owned brands and the category's tracked competitors. Together these are the share-of-voice denominator.",
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
  },
  request: {
    url: (params) =>
      buildGaugeUrl(
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}/brands`
      ),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeBrandList
    return {
      success: true,
      output: {
        brands: (data.data ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          slug: item.slug,
          website: item.website,
          role: item.role,
        })),
        nextCursor: data.nextCursor ?? null,
      },
    }
  },
  outputs: {
    brands: {
      type: 'array',
      items: { type: 'object', properties: BRAND_OUT_PROPERTIES },
      description: 'Brands',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for the next page; null when complete',
      nullable: true,
      optional: true,
    },
  },
}
