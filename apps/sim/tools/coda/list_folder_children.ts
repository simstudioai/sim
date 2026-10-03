import type {
  CodaListFolderChildrenParams,
  CodaListFolderChildrenResponse,
} from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  codaPath,
  FOLDER_CHILD_PROPERTIES,
  FOLDER_ID_PARAM,
  LIMIT_PARAM,
  mapFolder,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_TOKEN_PARAM,
  type RawCodaFolder,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaListFolderChildrenTool: ToolConfig<
  CodaListFolderChildrenParams,
  CodaListFolderChildrenResponse
> = {
  id: 'coda_list_folder_children',
  name: 'Coda List Subfolders',
  description:
    'List the direct subfolders of a Coda folder. Subfolders you cannot access but manage the parent of are returned with only an ID and restricted visibility.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    folderId: FOLDER_ID_PARAM,
    limit: LIMIT_PARAM,
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaPath('folders', [params.folderId, 'folderId'], 'children'), {
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
        children: (data.items ?? []).map((folder) => {
          const { icon: _icon, ...child } = mapFolder(folder)
          return { ...child, visibility: folder.visibility ?? 'visible' }
        }),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    children: {
      type: 'array',
      description: 'Direct subfolders',
      items: {
        type: 'object',
        properties: {
          ...FOLDER_CHILD_PROPERTIES,
          visibility: {
            type: 'string',
            description:
              'visible, or restricted when only the ID is returned because you cannot access the subfolder',
          },
        },
      },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
