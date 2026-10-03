import type { CodaDeleteFolderResponse, CodaFolderParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  codaPath,
  FOLDER_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaDeleteFolderTool: ToolConfig<CodaFolderParams, CodaDeleteFolderResponse> = {
  id: 'coda_delete_folder',
  name: 'Coda Delete Folder',
  description: 'Delete an empty Coda folder (it must contain no docs)',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, folderId: FOLDER_ID_PARAM },

  request: {
    url: (params) => buildCodaUrl(codaPath('folders', [params.folderId, 'folderId'])),
    method: 'DELETE',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (_response, params) => ({
    success: true,
    output: { folderId: String(params?.folderId ?? '').trim() },
  }),

  outputs: {
    folderId: { type: 'string', description: 'ID of the deleted folder' },
  },
}
