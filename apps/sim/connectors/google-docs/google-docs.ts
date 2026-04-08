import { createLogger } from '@sim/logger'
import { GoogleDocsIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('GoogleDocsConnector')

/**
 * Represents a Google Drive file entry returned by the Drive API.
 */
interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  createdTime?: string
  webViewLink?: string
  owners?: { displayName?: string; emailAddress?: string }[]
}

/**
 * Represents a structural element within a Google Docs document body.
 */
interface DocsStructuralElement {
  paragraph?: {
    paragraphStyle?: {
      namedStyleType?: string
    }
    elements?: {
      textRun?: {
        content?: string
      }
    }[]
  }
}

/**
 * Represents the response from the Google Docs API for a single document.
 */
interface DocsDocument {
  documentId: string
  title: string
  body?: {
    content?: DocsStructuralElement[]
  }
}

/**
 * Maps a Google Docs heading style to a Markdown heading prefix.
 */
function headingPrefix(namedStyleType?: string): string {
  switch (namedStyleType) {
    case 'HEADING_1':
      return '# '
    case 'HEADING_2':
      return '## '
    case 'HEADING_3':
      return '### '
    case 'HEADING_4':
      return '#### '
    case 'HEADING_5':
      return '##### '
    case 'HEADING_6':
      return '###### '
    default:
      return ''
  }
}

/**
 * Extracts plain text from a Google Docs API structured document response.
 * Headings are prefixed with Markdown-style `#` markers.
 */
function extractTextFromDocsBody(doc: DocsDocument): string {
  const elements = doc.body?.content
  if (!elements) return ''

  const parts: string[] = []

  for (const element of elements) {
    const paragraph = element.paragraph
    if (!paragraph?.elements) continue

    const prefix = headingPrefix(paragraph.paragraphStyle?.namedStyleType)
    const text = paragraph.elements.map((el) => el.textRun?.content ?? '').join('')

    if (text.trim()) {
      parts.push(`${prefix}${text}`)
    }
  }

  return parts.join('').trim()
}

/**
 * Fetches the structured content of a Google Doc via the Docs API and
 * extracts it as plain text.
 */
async function fetchDocContent(accessToken: string, documentId: string): Promise<string> {
  const url = `https://docs.googleapis.com/v1/documents/${documentId}?fields=body.content`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Google Doc content ${documentId}: ${response.status}`)
  }

  const doc = (await response.json()) as DocsDocument
  return extractTextFromDocsBody(doc)
}

/**
 * Creates a lightweight stub from a Drive file entry. Content is deferred
 * and only fetched via getDocument for new or changed documents.
 */
function fileToStub(file: DriveFile): ExternalDocument {
  return {
    externalId: file.id,
    title: file.name || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`,
    contentHash: `gdocs:${file.id}:${file.modifiedTime ?? ''}`,
    metadata: {
      modifiedTime: file.modifiedTime,
      createdTime: file.createdTime,
      owners: file.owners?.map((o) => o.displayName || o.emailAddress).filter(Boolean),
    },
  }
}

/**
 * Builds the Drive API query string for listing Google Docs.
 */
function buildQuery(sourceConfig: Record<string, unknown>): string {
  const parts: string[] = ['trashed = false', "mimeType = 'application/vnd.google-apps.document'"]

  const folderId = sourceConfig.folderId as string | undefined
  if (folderId?.trim()) {
    parts.push(`'${folderId.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents`)
  }

  return parts.join(' and ')
}

export const googleDocsConnector: ConnectorConfig = {
  id: 'google_docs',
  name: 'Google Docs',
  description: 'Sync Google Docs documents into your knowledge base',
  version: '1.0.0',
  icon: GoogleDocsIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-docs',
    requiredScopes: ['https://www.googleapis.com/auth/drive'],
  },

  configFields: [
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'e.g. 1aBcDeFgHiJkLmNoPqRsTuVwXyZ (optional)',
      required: false,
    },
    {
      id: 'maxDocs',
      title: 'Max Documents',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const query = buildQuery(sourceConfig)
    const pageSize = 100

    const queryParams = new URLSearchParams({
      q: query,
      pageSize: String(pageSize),
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })

    if (cursor) {
      queryParams.set('pageToken', cursor)
    }

    const url = `https://www.googleapis.com/drive/v3/files?${queryParams.toString()}`

    logger.info('Listing Google Docs', { query, cursor: cursor ?? 'initial' })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Google Docs', {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to list Google Docs: ${response.status}`)
    }

    const data = await response.json()
    const files = (data.files || []) as DriveFile[]

    const maxDocs = sourceConfig.maxDocs ? Number(sourceConfig.maxDocs) : 0
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

    let documents = files.map(fileToStub)
    if (maxDocs > 0) {
      const remaining = maxDocs - previouslyFetched
      if (documents.length > remaining) {
        documents = documents.slice(0, remaining)
      }
    }

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxDocs > 0 && totalFetched >= maxDocs

    const nextPageToken = data.nextPageToken as string | undefined

    return {
      documents,
      nextCursor: hitLimit ? undefined : nextPageToken,
      hasMore: hitLimit ? false : Boolean(nextPageToken),
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const fields = 'id,name,mimeType,modifiedTime,createdTime,webViewLink,owners,trashed'
    const url = `https://www.googleapis.com/drive/v3/files/${externalId}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Google Doc metadata: ${response.status}`)
    }

    const file = (await response.json()) as DriveFile & { trashed?: boolean }

    if (file.trashed) return null
    if (file.mimeType !== 'application/vnd.google-apps.document') return null

    try {
      const content = await fetchDocContent(accessToken, file.id)
      if (!content.trim()) return null

      return { ...fileToStub(file), content, contentDeferred: false }
    } catch (error) {
      logger.warn(`Failed to extract content from document: ${file.name} (${file.id})`, {
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const folderId = sourceConfig.folderId as string | undefined
    const maxDocs = sourceConfig.maxDocs as string | undefined

    if (maxDocs && (Number.isNaN(Number(maxDocs)) || Number(maxDocs) <= 0)) {
      return { valid: false, error: 'Max documents must be a positive number' }
    }

    try {
      if (folderId?.trim()) {
        const url = `https://www.googleapis.com/drive/v3/files/${folderId.trim()}?fields=id,name,mimeType&supportsAllDrives=true`
        const response = await fetchWithRetry(
          url,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          },
          VALIDATE_RETRY_OPTIONS
        )

        if (!response.ok) {
          if (response.status === 404) {
            return { valid: false, error: 'Folder not found. Check the folder ID and permissions.' }
          }
          return { valid: false, error: `Failed to access folder: ${response.status}` }
        }

        const folder = await response.json()
        if (folder.mimeType !== 'application/vnd.google-apps.folder') {
          return { valid: false, error: 'The provided ID is not a folder' }
        }
      } else {
        const url =
          "https://www.googleapis.com/drive/v3/files?pageSize=1&q=mimeType%3D'application%2Fvnd.google-apps.document'&fields=files(id)"
        const response = await fetchWithRetry(
          url,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          },
          VALIDATE_RETRY_OPTIONS
        )

        if (!response.ok) {
          return { valid: false, error: `Failed to access Google Docs: ${response.status}` }
        }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'owners', displayName: 'Owner', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const owners = joinTagArray(metadata.owners)
    if (owners) result.owners = owners

    const lastModified = parseTagDate(metadata.modifiedTime)
    if (lastModified) result.lastModified = lastModified

    return result
  },
}
