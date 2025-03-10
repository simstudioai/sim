import { ToolConfig } from '../types'
import { GoogleDocsReadResponse, GoogleDocsToolParams } from './types'

export const readTool: ToolConfig<GoogleDocsToolParams, GoogleDocsReadResponse> = {
  id: 'google_docs_read',
  name: 'Read Google Docs Document',
  description: 'Read content from a Google Docs document',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-docs',
    additionalScopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  },
  params: {
    accessToken: { type: 'string', required: true },
    documentId: { type: 'string', required: true },
  },
  request: {
    url: (params) => {
      // Ensure documentId is valid
      const documentId = params.documentId?.trim()
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
    if (data.body && data.body.content) {
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
  transformError: async (error) => {
    const errorMessage =
      typeof error === 'object' && error !== null
        ? error.message || JSON.stringify(error, null, 2)
        : error.toString() || 'An error occurred while reading Google Docs document'

    return {
      success: false,
      output: {
        content: '',
        metadata: {
          documentId: '',
          title: '',
        },
      },
      error: errorMessage,
    }
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
        if (paragraphElement.textRun && paragraphElement.textRun.content) {
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
                  if (paragraphElement.textRun && paragraphElement.textRun.content) {
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
