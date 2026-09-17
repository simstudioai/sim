import type {
  CodaGetPageContentParams,
  CodaGetPageContentResponse,
  CodaPageContentItem,
} from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_ID_PARAM,
  PAGE_TOKEN_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

interface RawPageContentItem {
  id: string
  type: string
  itemContent?: { style?: string; format?: string; content?: string; lineLevel?: number }
}

export const codaGetPageContentTool: ToolConfig<
  CodaGetPageContentParams,
  CodaGetPageContentResponse
> = {
  id: 'coda_get_page_content',
  name: 'Coda Get Page Content',
  description:
    'Read the content of a Coda canvas page as plain-text lines with their styles (headings, paragraphs, lists, quotes, code) and element IDs',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    pageId: PAGE_ID_PARAM,
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of content items to return (1-500, default 50)',
    },
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'pages', [params.pageId, 'pageId'], 'content'), {
        limit: params.limit,
        pageToken: optionalTrimmed(params.pageToken),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as {
      items?: RawPageContentItem[]
      nextPageToken?: string
    }
    const items: CodaPageContentItem[] = (data.items ?? []).map((item) => ({
      id: item.id,
      type: item.type,
      style: item.itemContent?.style ?? null,
      format: item.itemContent?.format ?? null,
      content: item.itemContent?.content ?? null,
      lineLevel: item.itemContent?.lineLevel ?? null,
    }))
    return { success: true, output: { items, nextPageToken: data.nextPageToken || null } }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Content elements on the page, in order',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Element ID, usable with Update Page and Delete Page Content',
          },
          type: { type: 'string', description: 'Element type (line)' },
          style: {
            type: 'string',
            description:
              'Line style (paragraph, h1, h2, h3, bulletedList, numberedList, checkboxList, collapsibleList, blockQuote, pullQuote, code)',
            optional: true,
          },
          format: { type: 'string', description: 'Content format (plainText)', optional: true },
          content: { type: 'string', description: 'Element text', optional: true },
          lineLevel: {
            type: 'number',
            description: 'Indentation level for paragraphs, quotes, and list items',
            optional: true,
          },
        },
      },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
