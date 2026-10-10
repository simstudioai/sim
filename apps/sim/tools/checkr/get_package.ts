import {
  type CheckrPackageIdParams,
  type CheckrPackageResponse,
  PACKAGE_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapPackage,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetPackageTool: ToolConfig<CheckrPackageIdParams, CheckrPackageResponse> = {
  id: 'checkr_get_package',
  name: 'Checkr Get Package',
  description: 'Retrieve a package by ID, including its slug, price, and screenings.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    packageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the package',
    },
  },

  request: {
    url: (params) => checkrUrl(`/packages/${checkrId(params.packageId, 'packageId')}`),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { package: mapPackage(data) } }
  },

  outputs: {
    package: { type: 'object', description: 'The package', properties: PACKAGE_PROPERTIES },
  },
}
