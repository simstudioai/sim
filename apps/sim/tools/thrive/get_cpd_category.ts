import type { ThriveCpdCategoryResponse, ThriveGetCpdCategoryParams } from '@/tools/thrive/types'
import { THRIVE_CPD_CATEGORY_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const getCpdCategoryTool: ToolConfig<ThriveGetCpdCategoryParams, ThriveCpdCategoryResponse> =
  {
    id: 'thrive_get_cpd_category',
    name: 'Thrive Get CPD Category',
    description: 'Get a single CPD category in Thrive by its ID.',
    version: '1.0.0',

    params: {
      tenantId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Thrive Tenant ID (used as the Basic auth username)',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Thrive API key (used as the Basic auth password)',
      },
      host: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Region-specific API host',
      },
      categoryId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The CPD category ID',
      },
    },

    request: {
      url: (params) =>
        `${getThriveBaseUrl(params.host, 'v1')}/cpdCategories/${encodeURIComponent(params.categoryId)}`,
      method: 'GET',
      headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    },

    transformResponse: async (response: Response): Promise<ThriveCpdCategoryResponse> => {
      const data = await parseThriveResponse(response, 'Failed to get CPD category')
      return { success: true, output: { category: data ?? null } }
    },

    outputs: {
      category: {
        type: 'object',
        description: 'The CPD category',
        properties: THRIVE_CPD_CATEGORY_OUTPUT_PROPERTIES,
      },
    },
  }
