import type { CodaListPermissionsParams, CodaListPermissionsResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  LIMIT_PARAM,
  mapPermission,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_TOKEN_PARAM,
  PERMISSION_PROPERTIES,
  type RawCodaPermission,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaListPermissionsTool: ToolConfig<
  CodaListPermissionsParams,
  CodaListPermissionsResponse
> = {
  id: 'coda_list_permissions',
  name: 'Coda List Permissions',
  description: 'List who a Coda doc is shared with and their access levels',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    limit: LIMIT_PARAM,
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'acl', 'permissions'), {
        limit: params.limit,
        pageToken: optionalTrimmed(params.pageToken),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as {
      items?: RawCodaPermission[]
      nextPageToken?: string
    }
    return {
      success: true,
      output: {
        permissions: (data.items ?? []).map(mapPermission),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    permissions: {
      type: 'array',
      description: 'Permissions granted on the doc',
      items: { type: 'object', properties: PERMISSION_PROPERTIES },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
