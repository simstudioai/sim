import { generateShortId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import type { GoogleDocsCreateResponse, GoogleDocsToolParams } from '@/tools/google_docs/types'
import type { ToolConfig } from '@/tools/types'

const DOC_MIME_TYPE = 'application/vnd.google-apps.document'

/**
 * Build a multipart/related body for Drive's files.create upload endpoint.
 * Creates the document and its content atomically through Drive import conversion.
 * See: https://developers.google.com/workspace/drive/api/guides/manage-uploads
 */
function buildContentMultipartBody(
  metadata: Record<string, unknown>,
  content: string,
  markdown: boolean,
  boundary: string
): string {
  return (
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${markdown ? 'text/markdown' : 'text/plain'}; charset=UTF-8\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`
  )
}

function hasContent(params: GoogleDocsToolParams): boolean {
  return Boolean(params.content)
}

export const createTool: ToolConfig<GoogleDocsToolParams, GoogleDocsCreateResponse> = {
  id: 'google_docs_create',
  name: 'Create Google Docs Document',
  description: 'Create a new Google Docs document',
  version: '1.0',
  assistant: {
    effect: 'write',
    version: 1,
    reviewFields: [
      { name: 'folderSelector', label: 'Folder', target: true },
      { name: 'title', label: 'Title', editable: true },
      { name: 'content', label: 'Content', format: 'multiline', editable: true },
    ],
  },

  oauth: {
    required: true,
    provider: 'google-docs',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Docs API',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the document to create',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The content of the document to create',
    },
    folderSelector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Google Drive folder ID to create the document in (e.g., 1ABCxyz...)',
    },
    folderId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The ID of the folder to create the document in (internal use)',
    },
    markdown: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When true, content is interpreted as Markdown and converted to formatted Google Docs content (headings, bold/italic, lists, tables, links, code blocks, blockquotes). Default: false (content inserted as plain text).',
    },
  },

  request: {
    url: (params) => {
      return hasContent(params)
        ? 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true'
        : 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true'
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      if (hasContent(params)) {
        const boundary = `sim_gdocs_${generateShortId(24)}`
        // The request builder passes this same object to body().
        ;(params as GoogleDocsToolParams & { _boundary?: string })._boundary = boundary
        return {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        }
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      if (!params.title) {
        throw new Error('Title is required')
      }

      const folderId = params.folderSelector || params.folderId
      const metadata: Record<string, unknown> = {
        name: params.title,
        mimeType: DOC_MIME_TYPE,
      }
      if (folderId) {
        metadata.parents = [folderId]
      }

      if (hasContent(params)) {
        const boundary = (params as GoogleDocsToolParams & { _boundary?: string })._boundary
        if (!boundary) {
          throw new Error(
            'Multipart boundary missing on params — headers() must run before body() for content upload'
          )
        }
        return buildContentMultipartBody(
          metadata,
          params.content ?? '',
          Boolean(params.markdown),
          boundary
        )
      }

      return metadata
    },
  },

  transformResponse: async (response: Response) => {
    const data = toRecord(await response.json())
    if (typeof data.id !== 'string' || !data.id)
      throw new Error('Google Drive returned no document ID')
    return {
      success: true,
      output: {
        metadata: {
          documentId: data.id,
          title: typeof data.name === 'string' ? data.name : 'Untitled Document',
          mimeType: DOC_MIME_TYPE,
          url: `https://docs.google.com/document/d/${data.id}/edit`,
        },
      },
    }
  },

  outputs: {
    metadata: {
      type: 'json',
      description: 'Created document metadata including ID, title, and URL',
      properties: {
        documentId: { type: 'string', description: 'Google Docs document ID' },
        title: { type: 'string', description: 'Document title' },
        mimeType: { type: 'string', description: 'Document MIME type' },
        url: { type: 'string', description: 'Document URL' },
      },
    },
  },
}
