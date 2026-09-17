import type { CodaFolderResponse, CodaUpdateFolderParams } from '@/tools/coda/types'
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
  optionalTrimmed,
  type RawCodaFolder,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaUpdateFolderTool: ToolConfig<CodaUpdateFolderParams, CodaFolderResponse> = {
  id: 'coda_update_folder',
  name: 'Coda Update Folder',
  description:
    'Rename a Coda folder or change its description. Coda can return the folder as it was before the change; read it again to confirm.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    folderId: FOLDER_ID_PARAM,
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name of the folder',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description of the folder',
    },
  },

  request: {
    url: (params) => buildCodaUrl(codaPath('folders', [params.folderId, 'folderId'])),
    method: 'PATCH',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => {
      const name = optionalTrimmed(params.name)
      const description = params.description ? params.description : undefined
      if (!name && description === undefined) {
        throw new Error('Provide a name or description to update')
      }
      return {
        ...(name ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      }
    },
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawCodaFolder
    return { success: true, output: { folder: mapFolder(data) } }
  },

  outputs: {
    folder: { type: 'object', description: 'The updated folder', properties: FOLDER_PROPERTIES },
  },
}
