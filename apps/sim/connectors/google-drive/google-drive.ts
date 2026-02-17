import { createLogger } from '@sim/logger'
import { GoogleDriveIcon } from '@/components/icons'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'

const logger = createLogger('GoogleDriveConnector')

const GOOGLE_WORKSPACE_MIME_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
}

const SUPPORTED_TEXT_MIME_TYPES = [
  'text/plain',
  'text/csv',
  'text/html',
  'text/markdown',
  'application/json',
  'application/xml',
]

const MAX_EXPORT_SIZE = 10 * 1024 * 1024 // 10 MB (Google export limit)

async function computeContentHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function isGoogleWorkspaceFile(mimeType: string): boolean {
  return mimeType in GOOGLE_WORKSPACE_MIME_TYPES
}

function isSupportedTextFile(mimeType: string): boolean {
  return SUPPORTED_TEXT_MIME_TYPES.some((t) => mimeType.startsWith(t))
}

function htmlToPlainText(html: string): string {
  let text = html.replace(/<[^>]*>/g, ' ')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
  return text.replace(/\s+/g, ' ').trim()
}

async function exportGoogleWorkspaceFile(
  accessToken: string,
  fileId: string,
  sourceMimeType: string
): Promise<string> {
  const exportMimeType = GOOGLE_WORKSPACE_MIME_TYPES[sourceMimeType]
  if (!exportMimeType) {
    throw new Error(`Unsupported Google Workspace MIME type: ${sourceMimeType}`)
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`

  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to export file ${fileId}: ${response.status}`)
  }

  return response.text()
}

async function downloadTextFile(accessToken: string, fileId: string): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`

  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to download file ${fileId}: ${response.status}`)
  }

  const text = await response.text()
  if (text.length > MAX_EXPORT_SIZE) {
    return text.slice(0, MAX_EXPORT_SIZE)
  }
  return text
}

async function fetchFileContent(
  accessToken: string,
  fileId: string,
  mimeType: string
): Promise<string> {
  if (isGoogleWorkspaceFile(mimeType)) {
    return exportGoogleWorkspaceFile(accessToken, fileId, mimeType)
  }
  if (mimeType === 'text/html') {
    const html = await downloadTextFile(accessToken, fileId)
    return htmlToPlainText(html)
  }
  if (isSupportedTextFile(mimeType)) {
    return downloadTextFile(accessToken, fileId)
  }

  throw new Error(`Unsupported MIME type for content extraction: ${mimeType}`)
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  createdTime?: string
  webViewLink?: string
  parents?: string[]
  owners?: { displayName?: string; emailAddress?: string }[]
  size?: string
  starred?: boolean
  trashed?: boolean
}

function buildQuery(sourceConfig: Record<string, unknown>): string {
  const parts: string[] = ['trashed = false']

  const folderId = sourceConfig.folderId as string | undefined
  if (folderId?.trim()) {
    parts.push(`'${folderId.trim()}' in parents`)
  }

  const fileType = (sourceConfig.fileType as string) || 'all'
  switch (fileType) {
    case 'documents':
      parts.push("mimeType = 'application/vnd.google-apps.document'")
      break
    case 'spreadsheets':
      parts.push("mimeType = 'application/vnd.google-apps.spreadsheet'")
      break
    case 'presentations':
      parts.push("mimeType = 'application/vnd.google-apps.presentation'")
      break
    case 'text':
      parts.push(`(${SUPPORTED_TEXT_MIME_TYPES.map((t) => `mimeType = '${t}'`).join(' or ')})`)
      break
    default: {
      // Include Google Workspace files + plain text files, exclude folders
      const allMimeTypes = [
        ...Object.keys(GOOGLE_WORKSPACE_MIME_TYPES),
        ...SUPPORTED_TEXT_MIME_TYPES,
      ]
      parts.push(`(${allMimeTypes.map((t) => `mimeType = '${t}'`).join(' or ')})`)
      break
    }
  }

  return parts.join(' and ')
}

async function fileToDocument(
  accessToken: string,
  file: DriveFile
): Promise<ExternalDocument | null> {
  try {
    const content = await fetchFileContent(accessToken, file.id, file.mimeType)
    if (!content.trim()) {
      logger.info(`Skipping empty file: ${file.name} (${file.id})`)
      return null
    }

    const contentHash = await computeContentHash(content)

    return {
      externalId: file.id,
      title: file.name || 'Untitled',
      content,
      mimeType: 'text/plain',
      sourceUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      contentHash,
      metadata: {
        originalMimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        createdTime: file.createdTime,
        owners: file.owners?.map((o) => o.displayName || o.emailAddress).filter(Boolean),
        starred: file.starred,
        fileSize: file.size ? Number(file.size) : undefined,
      },
    }
  } catch (error) {
    logger.warn(`Failed to extract content from file: ${file.name} (${file.id})`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export const googleDriveConnector: ConnectorConfig = {
  id: 'google_drive',
  name: 'Google Drive',
  description: 'Sync documents from Google Drive into your knowledge base',
  version: '1.0.0',
  icon: GoogleDriveIcon,

  oauth: {
    required: true,
    provider: 'google-drive',
    requiredScopes: ['https://www.googleapis.com/auth/drive.readonly'],
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
      id: 'fileType',
      title: 'File Type',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'All supported files', id: 'all' },
        { label: 'Google Docs only', id: 'documents' },
        { label: 'Google Sheets only', id: 'spreadsheets' },
        { label: 'Google Slides only', id: 'presentations' },
        { label: 'Plain text files only', id: 'text' },
      ],
    },
    {
      id: 'maxFiles',
      title: 'Max Files',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string
  ): Promise<ExternalDocumentList> => {
    const query = buildQuery(sourceConfig)
    const pageSize = 100

    const queryParams = new URLSearchParams({
      q: query,
      pageSize: String(pageSize),
      fields:
        'nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,parents,owners,size,starred)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })

    if (cursor) {
      queryParams.set('pageToken', cursor)
    }

    const url = `https://www.googleapis.com/drive/v3/files?${queryParams.toString()}`

    logger.info('Listing Google Drive files', { query, cursor: cursor ?? 'initial' })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Google Drive files', {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to list Google Drive files: ${response.status}`)
    }

    const data = await response.json()
    const files = (data.files || []) as DriveFile[]

    const documentResults = await Promise.all(
      files.map((file) => fileToDocument(accessToken, file))
    )
    const documents = documentResults.filter(Boolean) as ExternalDocument[]

    const nextPageToken = data.nextPageToken as string | undefined
    const hasMore = Boolean(nextPageToken)

    return {
      documents,
      nextCursor: nextPageToken,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const fields =
      'id,name,mimeType,modifiedTime,createdTime,webViewLink,parents,owners,size,starred,trashed'
    const url = `https://www.googleapis.com/drive/v3/files/${externalId}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Google Drive file: ${response.status}`)
    }

    const file = (await response.json()) as DriveFile

    if (file.trashed) return null

    return fileToDocument(accessToken, file)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const folderId = sourceConfig.folderId as string | undefined
    const maxFiles = sourceConfig.maxFiles as string | undefined

    if (maxFiles && (Number.isNaN(Number(maxFiles)) || Number(maxFiles) <= 0)) {
      return { valid: false, error: 'Max files must be a positive number' }
    }

    // Verify access to Drive API
    try {
      if (folderId?.trim()) {
        // Verify the folder exists and is accessible
        const url = `https://www.googleapis.com/drive/v3/files/${folderId.trim()}?fields=id,name,mimeType&supportsAllDrives=true`
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        })

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
        // Verify basic Drive access by listing one file
        const url = 'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)'
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        })

        if (!response.ok) {
          return { valid: false, error: `Failed to access Google Drive: ${response.status}` }
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
    { id: 'fileType', displayName: 'File Type', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'starred', displayName: 'Starred', fieldType: 'boolean' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const owners = Array.isArray(metadata.owners) ? (metadata.owners as string[]) : []
    if (owners.length > 0) result.owners = owners.join(', ')

    if (typeof metadata.originalMimeType === 'string') {
      const mimeType = metadata.originalMimeType
      if (mimeType.includes('document')) result.fileType = 'Google Doc'
      else if (mimeType.includes('spreadsheet')) result.fileType = 'Google Sheet'
      else if (mimeType.includes('presentation')) result.fileType = 'Google Slides'
      else if (mimeType.startsWith('text/')) result.fileType = 'Text File'
      else result.fileType = mimeType
    }

    if (typeof metadata.modifiedTime === 'string') {
      const date = new Date(metadata.modifiedTime)
      if (!Number.isNaN(date.getTime())) result.lastModified = date
    }

    if (typeof metadata.starred === 'boolean') {
      result.starred = metadata.starred
    }

    return result
  },
}
