import type { CodaListDocsParams, CodaListDocsResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  DOC_PROPERTIES,
  LIMIT_PARAM,
  mapDoc,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_TOKEN_PARAM,
  type RawCodaDoc,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaListDocsTool: ToolConfig<CodaListDocsParams, CodaListDocsResponse> = {
  id: 'coda_list_docs',
  name: 'Coda List Docs',
  description:
    'List Coda docs the user has opened, most recently used first, filtered by search, owner, publishing, stars, workspace, folder, or source doc',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term used to filter docs',
    },
    isOwner: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return docs owned by the user',
    },
    isPublished: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return published docs',
    },
    isStarred: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'true returns only starred docs; false returns only unstarred docs',
    },
    inGallery: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return docs visible in the gallery',
    },
    sourceDoc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return docs copied from this doc ID',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return docs in this workspace (e.g., "ws-1Ab234")',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return docs in this folder (e.g., "fl-1Ab234")',
    },
    limit: LIMIT_PARAM,
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl('/docs', {
        query: optionalTrimmed(params.query),
        isOwner: params.isOwner,
        isPublished: params.isPublished,
        isStarred: params.isStarred,
        inGallery: params.inGallery,
        sourceDoc: optionalTrimmed(params.sourceDoc),
        workspaceId: optionalTrimmed(params.workspaceId),
        folderId: optionalTrimmed(params.folderId),
        limit: params.limit,
        pageToken: optionalTrimmed(params.pageToken),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { items?: RawCodaDoc[]; nextPageToken?: string }
    return {
      success: true,
      output: {
        docs: (data.items ?? []).map(mapDoc),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    docs: {
      type: 'array',
      description: 'Docs matching the filters',
      items: { type: 'object', properties: DOC_PROPERTIES },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
