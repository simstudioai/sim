import type { CodaFolderParams, CodaFolderResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  codaPath,
  FOLDER_ID_PARAM,
  FOLDER_PROPERTIES,
  mapFolder,
  type RawCodaFolder,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetFolderTool: ToolConfig<CodaFolderParams, CodaFolderResponse> = {
  id: 'coda_get_folder',
  name: 'Coda Get Folder',
  description: 'Get details about a Coda folder',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, folderId: FOLDER_ID_PARAM },

  request: {
    url: (params) => buildCodaUrl(codaPath('folders', [params.folderId, 'folderId'])),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawCodaFolder
    return { success: true, output: { folder: mapFolder(data) } }
  },

  outputs: {
    folder: { type: 'object', description: 'Folder details', properties: FOLDER_PROPERTIES },
  },
}
