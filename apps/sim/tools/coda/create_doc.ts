import type { CodaCreateDocParams, CodaCreateDocResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  buildPageCreateContent,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  DOC_PROPERTIES,
  mapDoc,
  optionalTrimmed,
  type RawCodaDoc,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaCreateDocTool: ToolConfig<CodaCreateDocParams, CodaCreateDocResponse> = {
  id: 'coda_create_doc',
  name: 'Coda Create Doc',
  description:
    'Create a Coda doc, optionally copying an existing doc and setting up its first page with Markdown, HTML, an embed, or a sync page. Requires Doc Maker access in the workspace.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title of the new doc (defaults to "Untitled")',
    },
    sourceDoc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of an existing doc to copy',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timezone for the new doc (e.g., "America/Los_Angeles")',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the folder to create the doc in (defaults to "My docs")',
    },
    pageName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the initial page',
    },
    pageSubtitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subtitle of the initial page',
    },
    iconName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Icon name for the initial page (e.g., "rocket")',
    },
    imageUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cover image URL for the initial page',
    },
    pageType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Initial page content type: "canvas" (default), "embed", or "syncPage"',
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
      description: 'Canvas content for the initial page in the chosen format',
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
    url: () => buildCodaUrl('/docs'),
    method: 'POST',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => {
      const pageContent = buildPageCreateContent(params)
      const initialPage = {
        ...(optionalTrimmed(params.pageName) ? { name: optionalTrimmed(params.pageName) } : {}),
        ...(params.pageSubtitle ? { subtitle: params.pageSubtitle } : {}),
        ...(optionalTrimmed(params.iconName) ? { iconName: optionalTrimmed(params.iconName) } : {}),
        ...(optionalTrimmed(params.imageUrl) ? { imageUrl: optionalTrimmed(params.imageUrl) } : {}),
        ...(pageContent ? { pageContent } : {}),
      }
      return {
        ...(optionalTrimmed(params.title) ? { title: optionalTrimmed(params.title) } : {}),
        ...(optionalTrimmed(params.sourceDoc)
          ? { sourceDoc: optionalTrimmed(params.sourceDoc) }
          : {}),
        ...(optionalTrimmed(params.timezone) ? { timezone: optionalTrimmed(params.timezone) } : {}),
        ...(optionalTrimmed(params.folderId) ? { folderId: optionalTrimmed(params.folderId) } : {}),
        ...(Object.keys(initialPage).length > 0 ? { initialPage } : {}),
      }
    },
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawCodaDoc & { requestId?: string }
    return { success: true, output: { doc: mapDoc(data), requestId: data.requestId ?? null } }
  },

  outputs: {
    doc: { type: 'object', description: 'The created doc', properties: DOC_PROPERTIES },
    requestId: {
      type: 'string',
      description: 'Coda request ID for the doc creation',
      nullable: true,
    },
  },
}
