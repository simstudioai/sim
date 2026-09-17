import type { CodaListFoldersParams, CodaListFoldersResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  FOLDER_PROPERTIES,
  LIMIT_PARAM,
  mapFolder,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_TOKEN_PARAM,
  type RawCodaFolder,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaListFoldersTool: ToolConfig<CodaListFoldersParams, CodaListFoldersResponse> = {
  id: 'coda_list_folders',
  name: 'Coda List Folders',
  description: 'List the Coda folders the user can access, optionally within one workspace',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return folders in this workspace (e.g., "ws-1Ab234")',
    },
    isStarred: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'true returns only starred folders; false returns only unstarred folders',
    },
    limit: LIMIT_PARAM,
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl('/folders', {
        workspaceId: optionalTrimmed(params.workspaceId),
        isStarred: params.isStarred,
        limit: params.limit,
        pageToken: optionalTrimmed(params.pageToken),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { items?: RawCodaFolder[]; nextPageToken?: string }
    return {
      success: true,
      output: {
        folders: (data.items ?? []).map(mapFolder),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    folders: {
      type: 'array',
      description: 'Folders the user can access',
      items: { type: 'object', properties: FOLDER_PROPERTIES },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
