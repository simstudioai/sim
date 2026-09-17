import type { CodaDeletePermissionParams, CodaDeletePermissionResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaDeletePermissionTool: ToolConfig<
  CodaDeletePermissionParams,
  CodaDeletePermissionResponse
> = {
  id: 'coda_delete_permission',
  name: 'Coda Remove Permission',
  description: 'Revoke a sharing permission on a Coda doc',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    permissionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the permission to remove (from List Permissions)',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(
        codaDocPath(params.docId, 'acl', 'permissions', [params.permissionId, 'permissionId'])
      ),
    method: 'DELETE',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (_response, params) => ({
    success: true,
    output: {
      docId: String(params?.docId ?? '').trim(),
      permissionId: String(params?.permissionId ?? '').trim(),
    },
  }),

  outputs: {
    docId: { type: 'string', description: 'ID of the doc' },
    permissionId: { type: 'string', description: 'ID of the removed permission' },
  },
}
