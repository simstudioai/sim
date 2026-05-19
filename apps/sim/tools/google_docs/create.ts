import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import type { GoogleDocsCreateResponse, GoogleDocsToolParams } from '@/tools/google_docs/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleDocsCreateTool')

const DOC_MIME_TYPE = 'application/vnd.google-apps.document'

/**
 * Build a multipart/related body for Drive's files.create upload endpoint.
 * Used when converting Markdown to a Google Doc in a single round-trip.
 * See: https://developers.google.com/workspace/drive/api/guides/manage-uploads
 */
function buildMarkdownMultipartBody(
  metadata: Record<string, unknown>,
  markdownContent: string,
  boundary: string
): string {
  return (
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/markdown\r\n\r\n` +
    `${markdownContent}\r\n` +
    `--${boundary}--`
  )
}

function shouldUseMarkdownUpload(params: GoogleDocsToolParams): boolean {
  return Boolean(params.markdown && params.content)
}

export const createTool: ToolConfig<GoogleDocsToolParams, GoogleDocsCreateResponse> = {
  id: 'google_docs_create',
  name: 'Create Google Docs Document',
  description: 'Create a new Google Docs document',
  version: '1.0',

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
      return shouldUseMarkdownUpload(params)
        ? 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true'
        : 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true'
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      if (shouldUseMarkdownUpload(params)) {
        const boundary = `sim_gdocs_md_${generateShortId(24)}`
        // Stash on params so body() uses the matching boundary string
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

      if (shouldUseMarkdownUpload(params)) {
        const boundary = (params as GoogleDocsToolParams & { _boundary?: string })._boundary
        if (!boundary) {
          // headers() runs before body() in formatRequestParams and stashes the boundary
          // on the same params reference. Missing _boundary means that contract was broken,
          // which would silently produce a Content-Type / body boundary mismatch (HTTP 400).
          // Throw loudly instead of fabricating a mismatched boundary.
          throw new Error(
            'Multipart boundary missing on params — headers() must run before body() for markdown upload'
          )
        }
        return buildMarkdownMultipartBody(metadata, params.content ?? '', boundary)
      }

      return metadata
    },
  },

  postProcess: async (result, params, executeTool) => {
    if (!result.success) {
      return result
    }

    const documentId = result.output.metadata.documentId

    // When the markdown upload path ran, content was already inserted via Drive's
    // text/markdown import conversion during files.create — no follow-up write needed.
    if (shouldUseMarkdownUpload(params)) {
      return result
    }

    if (params.content && documentId) {
      try {
        const writeParams = {
          accessToken: params.accessToken,
          documentId: documentId,
          content: params.content,
        }

        const writeResult = await executeTool('google_docs_write', writeParams)

        if (!writeResult.success) {
          logger.warn(
            'Failed to add content to document, but document was created:',
            writeResult.error
          )
        }
      } catch (error) {
        logger.warn('Error adding content to document:', { error })
        // Don't fail the overall operation if adding content fails
      }
    }

    return result
  },

  transformResponse: async (response: Response) => {
    try {
      // Get the response data
      const responseText = await response.text()
      const data = JSON.parse(responseText)

      const documentId = data.id
      const title = data.name

      const metadata = {
        documentId,
        title: title || 'Untitled Document',
        mimeType: DOC_MIME_TYPE,
        url: `https://docs.google.com/document/d/${documentId}/edit`,
      }

      return {
        success: true,
        output: {
          metadata,
        },
      }
    } catch (error) {
      logger.error('Google Docs create - Error processing response:', {
        error,
      })
      throw error
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
