import type { CodaCreateFolderParams, CodaFolderResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  FOLDER_PROPERTIES,
  mapFolder,
  optionalTrimmed,
  type RawCodaFolder,
  WORKSPACE_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaCreateFolderTool: ToolConfig<CodaCreateFolderParams, CodaFolderResponse> = {
  id: 'coda_create_folder',
  name: 'Coda Create Folder',
  description: 'Create a folder in a Coda workspace',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the folder',
    },
    workspaceId: WORKSPACE_ID_PARAM,
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the folder',
    },
  },

  request: {
    url: () => buildCodaUrl('/folders'),
    method: 'POST',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => ({
      name: String(params.name ?? '').trim(),
      workspaceId: String(params.workspaceId ?? '').trim(),
      ...(optionalTrimmed(params.description) ? { description: params.description } : {}),
    }),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawCodaFolder
    return { success: true, output: { folder: mapFolder(data) } }
  },

  outputs: {
    folder: { type: 'object', description: 'The created folder', properties: FOLDER_PROPERTIES },
  },
}
