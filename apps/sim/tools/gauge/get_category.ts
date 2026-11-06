import { CATEGORY_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeCategory,
  GaugeGetCategoryParams,
  GaugeGetCategoryResponse,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeGetCategoryTool: ToolConfig<GaugeGetCategoryParams, GaugeGetCategoryResponse> = {
  id: 'gauge_get_category',
  name: 'Gauge Get Category',
  description: 'Read the details of an AI-search category.',
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
        `/orgs/${safeUrlPathSegment(params.org, 'org')}/categories/${safeUrlPathSegment(params.category, 'category')}`
      ),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeCategory
    return {
      success: true,
      output: {
        category: { id: data.id, slug: data.slug, name: data.name, description: data.description },
      },
    }
  },
  outputs: {
    category: { type: 'json', properties: CATEGORY_PROPERTIES, description: 'Category' },
  },
}
