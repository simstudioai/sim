import type { ToolConfig } from '../types'
import type { GoogleDocsReadResponse, GoogleDocsToolParams } from './types'

export const readTool: ToolConfig<GoogleDocsToolParams, GoogleDocsReadResponse> = {
  id: 'google_docs_read',
  name: 'Read Google Docs Document',
  description: 'Read content from a Google Docs document',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-docs',
    additionalScopes: ['https://www.googleapis.com/auth/drive.file'],
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Docs API',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the document to read',
    },
  },
  request: {
    url: (params) => {
      // Ensure documentId is valid
      const documentId = params.documentId?.trim() || params.manualDocumentId?.trim()
      if (!documentId) {
        throw new Error('Document ID is required')
      }

      return `https://docs.googleapis.com/v1/documents/${documentId}`
    },
    method: 'GET',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to read Google Docs document: ${errorText}`)
    }

    const data = await response.json()

    // Extract document content from the response
    let content = ''
    if (data.body?.content) {
      content = extractTextFromDocument(data)
    }

    // Create document metadata
    const metadata = {
      documentId: data.documentId,
      title: data.title || 'Untitled Document',
      mimeType: 'application/vnd.google-apps.document',
      url: `https://docs.google.com/document/d/${data.documentId}/edit`,
    }

    return {
      success: true,
      output: {
        content,
        metadata,
      },
    }
  },
  transformError: (error) => {
    // If it's an Error instance with a message, use that
    if (error instanceof Error) {
      return error.message
    }

    // If it's an object with an error or message property
    if (typeof error === 'object' && error !== null) {
      if (error.error) {
        return typeof error.error === 'string' ? error.error : JSON.stringify(error.error)
      }
      if (error.message) {
        return error.message
      }
    }

    // Default fallback message
    return 'An error occurred while reading Google Docs document'
  },
}

// Helper function to extract text content from Google Docs document structure
function extractTextFromDocument(document: any): string {
  let text = ''

  if (!document.body || !document.body.content) {
    return text
  }

  // Process each structural element in the document
  for (const element of document.body.content) {
    if (element.paragraph) {
      for (const paragraphElement of element.paragraph.elements) {
        if (paragraphElement.textRun?.content) {
          text += paragraphElement.textRun.content
        }
      }
    } else if (element.table) {
      // Process tables if needed
      for (const tableRow of element.table.tableRows) {
        for (const tableCell of tableRow.tableCells) {
          if (tableCell.content) {
            for (const cellContent of tableCell.content) {
              if (cellContent.paragraph) {
                for (const paragraphElement of cellContent.paragraph.elements) {
                  if (paragraphElement.textRun?.content) {
                    text += paragraphElement.textRun.content
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return text
}
