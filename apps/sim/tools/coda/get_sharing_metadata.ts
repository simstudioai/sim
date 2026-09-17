import type { CodaDocParams, CodaSharingMetadataResponse } from '@/tools/coda/types'
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

export const codaGetSharingMetadataTool: ToolConfig<CodaDocParams, CodaSharingMetadataResponse> = {
  id: 'coda_get_sharing_metadata',
  name: 'Coda Get Sharing Metadata',
  description:
    'Check whether the connected user can share or copy a Coda doc, and share it with the workspace or organization',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, docId: DOC_ID_PARAM },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId, 'acl', 'metadata')),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as CodaSharingMetadataResponse['output']
    return {
      success: true,
      output: {
        canShare: data.canShare,
        canShareWithWorkspace: data.canShareWithWorkspace,
        canShareWithOrg: data.canShareWithOrg,
        canCopy: data.canCopy,
      },
    }
  },

  outputs: {
    canShare: { type: 'boolean', description: 'Whether the user can share the doc' },
    canShareWithWorkspace: {
      type: 'boolean',
      description: 'Whether the user can share the doc with the workspace',
    },
    canShareWithOrg: {
      type: 'boolean',
      description: 'Whether the user can share the doc with the organization',
    },
    canCopy: { type: 'boolean', description: 'Whether the user can copy the doc' },
  },
}
