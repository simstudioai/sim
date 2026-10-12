import {
  type CheckrListPackagesParams,
  type CheckrListPackagesResponse,
  LIST_META_OUTPUTS,
  PACKAGE_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_PAGINATION_PARAMS,
  checkrHeaders,
  checkrPaginationQuery,
  checkrUrl,
  mapListMeta,
  mapPackage,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListPackagesTool: ToolConfig<
  CheckrListPackagesParams,
  CheckrListPackagesResponse
> = {
  id: 'checkr_list_packages',
  name: 'Checkr List Packages',
  description:
    'List the background check packages on the account, with their slugs, prices, and included screenings.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    ...CHECKR_PAGINATION_PARAMS,
  },

  request: {
    url: (params) => checkrUrl('/packages', checkrPaginationQuery(params)),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        packages: (Array.isArray(data.data) ? data.data : []).map(mapPackage),
        ...mapListMeta(data),
      },
    }
  },

  outputs: {
    packages: {
      type: 'array',
      description: 'Packages on the account',
      items: { type: 'object', properties: PACKAGE_PROPERTIES },
    },
    ...LIST_META_OUTPUTS,
  },
}
