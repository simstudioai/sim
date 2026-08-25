import { ErrorExtractorId } from '@/tools/error-extractors'
import { escapeODataString, parseGraphErrorMessage } from '@/tools/microsoft_excel/utils'
import type {
  MicrosoftWordDocumentMetadata,
  MicrosoftWordListResponse,
  MicrosoftWordToolParams,
} from '@/tools/microsoft_word/types'
import { getDriveBasePath, getFolderBasePath } from '@/tools/microsoft_word/utils'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

const DRIVE_ITEM_SELECT = 'id,name,size,webUrl,createdDateTime,lastModifiedDateTime,file'

/** Microsoft Graph `driveItem` fields this tool projects. */
interface GraphDriveItem {
  id?: string
  name?: string
  size?: number
  webUrl?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  file?: { mimeType?: string }
  folder?: Record<string, unknown>
}

export const listTool: ToolConfig<MicrosoftWordToolParams, MicrosoftWordListResponse> = {
  id: 'microsoft_word_list',
  name: 'List Microsoft Word Documents',
  description:
    'List or search Microsoft Word (.docx) documents in OneDrive or SharePoint. Non-Word items are filtered out of the results.',
  version: '1.0',
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'microsoft-word',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Graph API',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search text matched against file name, metadata, and content. If omitted, the documents directly inside the folder are listed.',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the folder to list or search within. If omitted, the drive root is used.',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive to list from. Required for SharePoint. If omitted, uses the personal OneDrive.',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: `Maximum number of items to request from Microsoft Graph (1-${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE})`,
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Continuation URL from a previous response's nextPageToken, used to fetch the next page",
    },
  },

  request: {
    url: (params) => {
      const pageToken = params.pageToken?.trim()
      if (pageToken) {
        return assertGraphNextPageUrl(pageToken)
      }

      const folderId = params.folderId?.trim()
      const basePath = folderId
        ? getFolderBasePath(folderId, params.driveId)
        : `${getDriveBasePath(params.driveId)}/root`

      const requestedSize = Number(params.pageSize)
      const top =
        Number.isFinite(requestedSize) && requestedSize > 0
          ? Math.min(Math.trunc(requestedSize), MAX_PAGE_SIZE)
          : DEFAULT_PAGE_SIZE

      const search = new URLSearchParams({ $select: DRIVE_ITEM_SELECT, $top: String(top) })
      const query = params.query?.trim()

      if (!query) {
        return `${basePath}/children?${search.toString()}`
      }

      // Graph matches on file name and content, so the extension narrows the
      // result set before the client-side .docx filter runs.
      const searchText = encodeURIComponent(escapeODataString(`${query} .docx`))
      return `${basePath}/search(q='${searchText}')?${search.toString()}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return { Authorization: `Bearer ${params.accessToken}` }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(parseGraphErrorMessage(response.status, response.statusText, errorText))
    }

    const data = await response.json()
    const items: GraphDriveItem[] = Array.isArray(data?.value) ? data.value : []

    const documents: MicrosoftWordDocumentMetadata[] = items
      .filter((item) => !item.folder && item.id && item.name?.toLowerCase().endsWith('.docx'))
      .map((item) => ({
        documentId: item.id as string,
        name: item.name ?? null,
        mimeType: item.file?.mimeType ?? null,
        webViewLink: item.webUrl ?? null,
        size: item.size ?? null,
        createdTime: item.createdDateTime ?? null,
        modifiedTime: item.lastModifiedDateTime ?? null,
      }))

    const nextPageToken = getGraphNextPageUrl(data)

    return {
      success: true,
      output: { documents, ...(nextPageToken ? { nextPageToken } : {}) },
    }
  },

  outputs: {
    documents: {
      type: 'array',
      description: 'The Word documents that matched',
      items: {
        type: 'object',
        properties: {
          documentId: { type: 'string', description: 'The drive item ID of the document' },
          name: { type: 'string', description: 'The document file name', optional: true },
          mimeType: { type: 'string', description: 'The document MIME type', optional: true },
          webViewLink: {
            type: 'string',
            description: 'Browser URL for opening the document',
            optional: true,
          },
          size: { type: 'number', description: 'Document size in bytes', optional: true },
          createdTime: { type: 'string', description: 'ISO 8601 creation time', optional: true },
          modifiedTime: {
            type: 'string',
            description: 'ISO 8601 last modification time',
            optional: true,
          },
        },
      },
    },
    nextPageToken: {
      type: 'string',
      description: 'Continuation URL for the next page of results, when more remain',
      optional: true,
    },
  },
}
