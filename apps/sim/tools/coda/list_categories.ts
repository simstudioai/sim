import type { CodaAuthParams, CodaListCategoriesResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaListCategoriesTool: ToolConfig<CodaAuthParams, CodaListCategoriesResponse> = {
  id: 'coda_list_categories',
  name: 'Coda List Doc Categories',
  description: 'List the categories that can be applied to a published Coda doc',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams },

  request: {
    url: () => buildCodaUrl('/categories'),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { items?: Array<{ name?: string }> }
    return {
      success: true,
      output: {
        categories: (data.items ?? [])
          .map((category) => category.name)
          .filter((name): name is string => typeof name === 'string'),
      },
    }
  },

  outputs: {
    categories: {
      type: 'array',
      description: 'Category names usable when publishing a doc',
      items: { type: 'string', description: 'Category name' },
    },
  },
}
