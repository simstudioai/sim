/**
 * Resolve the document ID for a Docs API request, preferring the selected
 * document ID and falling back to a manually entered one. Throws when neither
 * is present so callers fail loudly before issuing a request.
 */
export function resolveDocumentId(params: {
  documentId?: string
  manualDocumentId?: string
}): string {
  const documentId = params.documentId?.trim() || params.manualDocumentId?.trim()
  if (!documentId) {
    throw new Error('Document ID is required')
  }
  return documentId
}

/**
 * Build a `Location` for a batchUpdate request when an insertion index is
 * provided, otherwise fall back to `endOfSegmentLocation` (end of the body).
 * The Docs API treats index 0 as invalid, so a positive index is required to
 * use an explicit location.
 */
export function buildInsertLocation(
  index?: number
): { location: { index: number } } | { endOfSegmentLocation: Record<string, never> } {
  if (typeof index === 'number' && Number.isFinite(index) && index >= 1) {
    return { location: { index } }
  }
  return { endOfSegmentLocation: {} }
}

/**
 * Build canonical Google Docs metadata from a batchUpdate response. The
 * `documentId` is taken from the response body when present, otherwise parsed
 * from the request URL (`.../documents/{id}:batchUpdate`).
 */
export function buildBatchUpdateMetadata(
  data: { documentId?: string },
  responseUrl: string
): { documentId: string; title: string; mimeType: string; url: string } {
  let documentId = data.documentId ?? ''
  if (!documentId) {
    const urlParts = responseUrl.split('/')
    for (let i = 0; i < urlParts.length; i++) {
      if (urlParts[i] === 'documents' && i + 1 < urlParts.length) {
        documentId = urlParts[i + 1].split(':')[0]
        break
      }
    }
  }

  return {
    documentId,
    title: 'Updated Document',
    mimeType: 'application/vnd.google-apps.document',
    url: `https://docs.google.com/document/d/${documentId}/edit`,
  }
}

// Helper function to extract text content from Google Docs document structure
export function extractTextFromDocument(document: any): string {
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
