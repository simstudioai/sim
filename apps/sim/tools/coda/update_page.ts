import type { CodaPageMutationResponse, CodaUpdatePageParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  optionalTrimmed,
  PAGE_ID_PARAM,
  REQUEST_ID_OUTPUT,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaUpdatePageTool: ToolConfig<CodaUpdatePageParams, CodaPageMutationResponse> = {
  id: 'coda_update_page',
  name: 'Coda Update Page',
  description:
    'Update a Coda page: rename it, change its subtitle, icon, cover, or visibility, and append, prepend, or replace content with Markdown or HTML. Applied asynchronously.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    pageId: PAGE_ID_PARAM,
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name of the page',
    },
    subtitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New subtitle of the page (an empty value leaves the subtitle unchanged)',
    },
    iconName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the page icon (e.g., "rocket")',
    },
    imageUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL of a cover image for the page',
    },
    isHidden: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the page is hidden (requires a paid Coda plan; ignored for pages that cannot be hidden)',
    },
    insertionMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How to apply content: "append", "prepend", or "replace". Required when content is provided.',
    },
    elementId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Page element to insert relative to or replace (e.g., "cl-lzqh0Q0poT"); omit to apply to the whole page',
    },
    contentFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content format: "markdown" (default) or "html"',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content to add to the page in the chosen format',
    },
  },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId, 'pages', [params.pageId, 'pageId'])),
    method: 'PUT',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (optionalTrimmed(params.name)) body.name = optionalTrimmed(params.name)
      if (params.subtitle) body.subtitle = params.subtitle
      if (optionalTrimmed(params.iconName)) body.iconName = optionalTrimmed(params.iconName)
      if (optionalTrimmed(params.imageUrl)) body.imageUrl = optionalTrimmed(params.imageUrl)
      if (typeof params.isHidden === 'boolean') body.isHidden = params.isHidden
      if (params.content) {
        if (!params.insertionMode) {
          throw new Error('insertionMode is required when updating page content')
        }
        const elementId = optionalTrimmed(params.elementId)
        body.contentUpdate = {
          insertionMode: params.insertionMode,
          ...(elementId ? { elementId } : {}),
          canvasContent: { format: params.contentFormat || 'markdown', content: params.content },
        }
      }
      if (Object.keys(body).length === 0) {
        throw new Error('Provide at least one page property or content to update')
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { requestId: string; id: string }
    return { success: true, output: { requestId: data.requestId, pageId: data.id } }
  },

  outputs: {
    requestId: REQUEST_ID_OUTPUT,
    pageId: { type: 'string', description: 'ID of the updated page' },
  },
}
