import type { CodaDeletePageContentParams, CodaPageMutationResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  PAGE_ID_PARAM,
  parseStringList,
  REQUEST_ID_OUTPUT,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaDeletePageContentTool: ToolConfig<
  CodaDeletePageContentParams,
  CodaPageMutationResponse
> = {
  id: 'coda_delete_page_content',
  name: 'Coda Delete Page Content',
  description:
    'Delete specific content elements from a Coda page, or all of its content when no element IDs are given. Applied asynchronously.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    pageId: PAGE_ID_PARAM,
    elementIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Element IDs to delete (from Get Page Content), as an array or comma-separated list',
    },
    deleteAll: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to true, with no element IDs, to delete all content from the page',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'pages', [params.pageId, 'pageId'], 'content')),
    method: 'DELETE',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => {
      const elementIds = parseStringList(params.elementIds, 'elementIds')
      if (elementIds.length > 0) return { elementIds }
      if (params.deleteAll !== true) {
        throw new Error('Provide elementIds, or set deleteAll to true to delete all page content')
      }
      return {}
    },
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { requestId: string; id: string }
    return { success: true, output: { requestId: data.requestId, pageId: data.id } }
  },

  outputs: {
    requestId: REQUEST_ID_OUTPUT,
    pageId: { type: 'string', description: 'ID of the page whose content was deleted' },
  },
}
