import type { CodaCreatePageParams, CodaPageMutationResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  buildPageCreateContent,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  optionalTrimmed,
  REQUEST_ID_OUTPUT,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaCreatePageTool: ToolConfig<CodaCreatePageParams, CodaPageMutationResponse> = {
  id: 'coda_create_page',
  name: 'Coda Create Page',
  description:
    'Create a page in a Coda doc, optionally as a subpage, with Markdown or HTML content, a full-page embed, or a sync page from another doc. The page is created asynchronously. Requires Doc Maker access.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the page',
    },
    subtitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subtitle of the page',
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
    parentPageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the parent page, to create this page as a subpage',
    },
    pageType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page content type: "canvas" (default), "embed", or "syncPage"',
    },
    contentFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Canvas content format: "markdown" (default) or "html"',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Canvas page content in the chosen format',
    },
    embedUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to embed as a full page (pageType "embed")',
    },
    renderMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Embed render method: "standard" or "compatibility"',
    },
    sourceDocId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Doc to sync from (pageType "syncPage")',
    },
    sourcePageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page to sync (pageType "syncPage" with syncMode "page")',
    },
    syncMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sync page mode: "page" (default) or "document"',
    },
    includeSubpages: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include subpages in a single-page sync page',
    },
  },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId, 'pages')),
    method: 'POST',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => {
      const pageContent = buildPageCreateContent(params)
      return {
        ...(optionalTrimmed(params.name) ? { name: optionalTrimmed(params.name) } : {}),
        ...(params.subtitle ? { subtitle: params.subtitle } : {}),
        ...(optionalTrimmed(params.iconName) ? { iconName: optionalTrimmed(params.iconName) } : {}),
        ...(optionalTrimmed(params.imageUrl) ? { imageUrl: optionalTrimmed(params.imageUrl) } : {}),
        ...(optionalTrimmed(params.parentPageId)
          ? { parentPageId: optionalTrimmed(params.parentPageId) }
          : {}),
        ...(pageContent ? { pageContent } : {}),
      }
    },
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { requestId: string; id: string }
    return { success: true, output: { requestId: data.requestId, pageId: data.id } }
  },

  outputs: {
    requestId: REQUEST_ID_OUTPUT,
    pageId: { type: 'string', description: 'ID of the created page' },
  },
}
