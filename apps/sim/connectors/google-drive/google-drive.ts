import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import {
  type DrivePermission,
  driveFileAcl,
  type OpenSharingPolicy,
} from '@/lib/knowledge/access/drive-permissions'
import {
  attachRetryHeaders,
  isRetryableError,
  type RetryOptions,
  resolveRetryDelayMs,
  retryWithExponentialBackoff,
  VALIDATE_RETRY_OPTIONS,
} from '@/lib/knowledge/documents/utils'
import { googleWorkspaceDomain, openGoogleDirectory } from '@/connectors/google-drive/directory'
import {
  GoogleDriveApiError,
  readGoogleDriveApiError,
} from '@/connectors/google-drive/google-drive-errors'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'
import type {
  ConnectorConfig,
  ExternalChange,
  ExternalChangeList,
  ExternalDocument,
  ExternalDocumentList,
} from '@/connectors/types'
import {
  buildDriveParentsClause,
  CONNECTOR_MAX_FILE_BYTES,
  ConnectorFileTooLargeError,
  htmlToPlainText,
  isSkippedDocument,
  joinTagArray,
  markSkipped,
  parseMultiValue,
  parseOptionalUnlimitedSafeInteger,
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
  stubOrSkipBySize,
  takeIndexableWithinCap,
} from '@/connectors/utils'

const logger = createLogger('GoogleDriveConnector')

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const GOOGLE_WORKSPACE_EXPORTS: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': XLSX_MIME_TYPE,
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

// Google Drive's `files.export` API rejects exports over 10 MB (exportSizeLimitExceeded),
// so this is a hard external limit for Google Workspace docs — not the connector cap.
const MAX_EXPORT_SIZE = 10 * 1024 * 1024
const MAX_FILES_VALIDATION_ERROR = 'Max files must be a positive safe integer, or 0 for unlimited'

function parseMaxFiles(value: unknown): number {
  return parseOptionalUnlimitedSafeInteger(value, MAX_FILES_VALIDATION_ERROR)
}

function googleDriveErrorLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof GoogleDriveApiError) {
    return {
      error: error.message,
      status: error.status,
      reasons: error.reasons,
    }
  }
  return { error: toError(error).message }
}

function isGoogleWorkspaceFile(mimeType: string): boolean {
  return mimeType in GOOGLE_WORKSPACE_EXPORTS
}

function isSupportedTextFile(mimeType: string): boolean {
  return SUPPORTED_TEXT_MIME_TYPES.some((t) => mimeType.startsWith(t))
}

/** Retries Google errors whose structured body identifies a transient rejection. */
async function fetchGoogleDriveWithRetry(
  url: string,
  options: RequestInit,
  retryOptions: RetryOptions = {}
): Promise<Response> {
  return retryWithExponentialBackoff(
    async () => {
      const response = await fetch(url, options)
      if (response.ok) return response

      const error = await readGoogleDriveApiError(response)
      attachRetryHeaders(error, response.headers)
      const waitMs = resolveRetryDelayMs(response.headers)
      if (waitMs !== undefined) error.retryAfterMs = waitMs
      throw error
    },
    {
      ...retryOptions,
      retryCondition: (error) =>
        error instanceof GoogleDriveApiError
          ? error.kind === 'transient' || isRetryableError(error)
          : (retryOptions.retryCondition?.(error) ?? isRetryableError(error)),
    }
  )
}

async function exportGoogleWorkspaceFile(
  accessToken: string,
  fileId: string,
  sourceMimeType: string
): Promise<Buffer> {
  const exportMimeType = GOOGLE_WORKSPACE_EXPORTS[sourceMimeType]
  if (!exportMimeType) {
    throw new Error(`Unsupported Google Workspace MIME type: ${sourceMimeType}`)
  }

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`

  let response: Response
  try {
    response = await fetchGoogleDriveWithRetry(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (error) {
    if (error instanceof GoogleDriveApiError && error.kind === 'export_too_large') {
      throw new ConnectorFileTooLargeError(MAX_EXPORT_SIZE)
    }
    throw error
  }

  const buffer = await readBodyWithLimit(response, MAX_EXPORT_SIZE)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(MAX_EXPORT_SIZE)
  }
  return buffer
}

async function downloadTextFile(accessToken: string, fileId: string): Promise<string> {
  // Listing runs with `includeItemsFromAllDrives`, so ids here can belong to a shared
  // drive; `supportsAllDrives` declares that support to `files.get` the same way the
  // metadata fetch in getDocument already does. (`files.export` takes no such param.)
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`

  const response = await fetchGoogleDriveWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Stream with a hard byte cap so a file with missing/under-reported listing
  // size metadata is never fully buffered into memory. Oversized files raise
  // DriveFileTooLargeError so getDocument can surface them as skipped (failed) rows.
  const buffer = await readBodyWithLimit(response, CONNECTOR_MAX_FILE_BYTES)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(CONNECTOR_MAX_FILE_BYTES)
  }
  return buffer.toString('utf8')
}

type FilePayload = Pick<ExternalDocument, 'content' | 'mimeType' | 'sourceFile'>

function xlsxFileName(name: string): string {
  return name.toLowerCase().endsWith('.xlsx') ? name : `${name}.xlsx`
}

async function fetchFilePayload(accessToken: string, file: DriveFile): Promise<FilePayload> {
  if (GOOGLE_WORKSPACE_EXPORTS[file.mimeType]) {
    const bytes = await exportGoogleWorkspaceFile(accessToken, file.id, file.mimeType)
    if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
      return {
        content: '',
        mimeType: XLSX_MIME_TYPE,
        sourceFile: {
          bytes,
          fileName: xlsxFileName(file.name || 'Untitled'),
          mimeType: XLSX_MIME_TYPE,
        },
      }
    }
    return { content: bytes.toString('utf8'), mimeType: 'text/plain' }
  }
  if (file.mimeType === 'text/html') {
    const html = await downloadTextFile(accessToken, file.id)
    return { content: htmlToPlainText(html), mimeType: 'text/plain' }
  }
  if (isSupportedTextFile(file.mimeType)) {
    return { content: await downloadTextFile(accessToken, file.id), mimeType: 'text/plain' }
  }

  throw new Error(`Unsupported MIME type for content extraction: ${file.mimeType}`)
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  createdTime?: string
  webViewLink?: string
  owners?: { displayName?: string; emailAddress?: string }[]
  size?: string
  starred?: boolean
  trashed?: boolean
  parents?: string[]
  permissions?: DrivePermission[]
  /**
   * Requested alongside `permissions` because Drive sometimes omits the
   * expanded permission objects while still reporting their ids — Onyx hit the
   * same thing. A file whose two counts disagree has an ACL we did not fully
   * see, so it is mirrored as readable by nobody rather than under a subset of
   * its real grants.
   */
  permissionIds?: string[]
  driveId?: string
}

interface DriveChange {
  changeType?: string
  removed?: boolean
  fileId?: string
  file?: DriveFile
}

interface DriveChangeListResponse {
  changes: DriveChange[]
  nextPageToken?: string
  newStartPageToken?: string
}

interface DriveFileListResponse {
  kind?: string
  files?: DriveFile[]
  incompleteSearch?: boolean
  nextPageToken?: string
}

function parseDriveFileListResponse(
  value: unknown
): DriveFileListResponse & { files: DriveFile[] } {
  if (!isPlainRecord(value)) {
    throw new Error('Google Drive API returned malformed file-list metadata')
  }
  const rawFiles = value.files
  if (rawFiles === undefined && value.kind !== 'drive#fileList') {
    throw new Error('Google Drive API returned malformed file-list metadata')
  }
  if (
    rawFiles !== undefined &&
    (!Array.isArray(rawFiles) || rawFiles.some((file) => !isDriveFileListItem(file)))
  ) {
    throw new Error('Google Drive API returned malformed file-list metadata')
  }
  if (
    value.nextPageToken !== undefined &&
    (typeof value.nextPageToken !== 'string' || value.nextPageToken.length === 0)
  ) {
    throw new Error('Google Drive API returned malformed file-list metadata')
  }
  if (value.incompleteSearch !== undefined && typeof value.incompleteSearch !== 'boolean') {
    throw new Error('Google Drive API returned malformed file-list metadata')
  }
  return {
    kind: typeof value.kind === 'string' ? value.kind : undefined,
    files: rawFiles ?? [],
    incompleteSearch: value.incompleteSearch === true,
    nextPageToken: typeof value.nextPageToken === 'string' ? value.nextPageToken : undefined,
  }
}

function isDriveFileMetadata(value: unknown, expectedId: string): value is DriveFile {
  return (
    isPlainRecord(value) &&
    value.id === expectedId &&
    typeof value.name === 'string' &&
    typeof value.mimeType === 'string' &&
    (value.trashed === undefined || typeof value.trashed === 'boolean')
  )
}

function isDriveFileListItem(value: unknown): value is DriveFile {
  return (
    isPlainRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.modifiedTime === 'string'
  )
}

function parseDriveFileMetadata(value: unknown, expectedId: string): DriveFile {
  if (!isDriveFileMetadata(value, expectedId)) {
    throw new Error('Google Drive API returned malformed file metadata')
  }
  return value
}

function parseDriveChangeListResponse(value: unknown): DriveChangeListResponse {
  if (!isPlainRecord(value)) {
    throw new Error('Google Drive API returned malformed change-list metadata')
  }
  const rawChanges = value.changes
  if (rawChanges !== undefined && !Array.isArray(rawChanges)) {
    throw new Error('Google Drive API returned malformed change-list metadata')
  }
  const changes: DriveChange[] = []
  for (const raw of rawChanges ?? []) {
    if (!isPlainRecord(raw) || typeof raw.fileId !== 'string' || raw.fileId.length === 0) {
      /** Shared-drive membership changes carry no fileId and are not files. */
      if (isPlainRecord(raw) && raw.changeType === 'drive') continue
      throw new Error('Google Drive API returned malformed change-list metadata')
    }
    if (raw.file !== undefined && !isDriveFileListItem(raw.file)) {
      throw new Error('Google Drive API returned malformed change-list metadata')
    }
    changes.push({
      changeType: typeof raw.changeType === 'string' ? raw.changeType : undefined,
      removed: raw.removed === true,
      fileId: raw.fileId,
      file: raw.file,
    })
  }
  for (const key of ['nextPageToken', 'newStartPageToken'] as const) {
    const token = value[key]
    if (token !== undefined && (typeof token !== 'string' || token.length === 0)) {
      throw new Error('Google Drive API returned malformed change-list metadata')
    }
  }
  return {
    changes,
    nextPageToken: typeof value.nextPageToken === 'string' ? value.nextPageToken : undefined,
    newStartPageToken:
      typeof value.newStartPageToken === 'string' ? value.newStartPageToken : undefined,
  }
}

/** The MIME types the `fileType` setting admits, mirroring {@link buildQuery}. */
function matchesFileType(fileType: string, mimeType: string): boolean {
  switch (fileType) {
    case 'documents':
      return mimeType === 'application/vnd.google-apps.document'
    case 'spreadsheets':
      return mimeType === 'application/vnd.google-apps.spreadsheet'
    case 'presentations':
      return mimeType === 'application/vnd.google-apps.presentation'
    case 'text':
      return SUPPORTED_TEXT_MIME_TYPES.includes(mimeType)
    default:
      return isGoogleWorkspaceFile(mimeType) || isSupportedTextFile(mimeType)
  }
}

/**
 * Whether a file reported by the change feed belongs to the configured
 * source. A listing applies these as a query; the feed reports every change
 * the account can see, so they are applied here instead. A file that left the
 * scope reads as removed, exactly as a listing would no longer return it.
 */
function isFileInScope(file: DriveFile, sourceConfig: Record<string, unknown>): boolean {
  if (file.trashed) return false
  if (!matchesFileType((sourceConfig.fileType as string) || 'all', file.mimeType)) return false
  const folderIds = parseMultiValue(sourceConfig.folderId)
  if (folderIds.length === 0) return true
  return (file.parents ?? []).some((parent) => folderIds.includes(parent))
}

function driveChangeToExternal(
  change: DriveChange,
  sourceConfig: Record<string, unknown>
): ExternalChange | null {
  if (change.changeType !== undefined && change.changeType !== 'file') return null
  const externalId = change.fileId
  if (!externalId) return null
  const file = change.file
  if (change.removed || !file || !isFileInScope(file, sourceConfig)) {
    return { kind: 'removed', externalId }
  }
  return {
    kind: 'upsert',
    externalId,
    document: stubOrSkipBySize(
      fileToStub(file),
      Number(file.size) || undefined,
      CONNECTOR_MAX_FILE_BYTES
    ),
  }
}

/**
 * Drive rejects an expired or foreign page token as a bad request rather than
 * with a dedicated status; a 404 or 410 is the same signal on other endpoints.
 * Reopening the feed from a full listing is the safe answer to all of them.
 */
function isDriveChangeCursorInvalidError(error: unknown): boolean {
  if (!(error instanceof GoogleDriveApiError)) return false
  if (error.status === 404 || error.status === 410) return true
  return (
    error.status === 400 &&
    (error.reasons.length === 0 ||
      error.reasons.some((reason) => reason === 'invalid' || reason === 'badRequest'))
  )
}

function buildQuery(sourceConfig: Record<string, unknown>, lastSyncAt?: Date): string {
  const parts: string[] = ['trashed = false']

  const parentsClause = buildDriveParentsClause(parseMultiValue(sourceConfig.folderId))
  if (parentsClause) parts.push(parentsClause)

  if (lastSyncAt) parts.push(`modifiedTime > '${lastSyncAt.toISOString()}'`)

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
      const allMimeTypes = [...Object.keys(GOOGLE_WORKSPACE_EXPORTS), ...SUPPORTED_TEXT_MIME_TYPES]
      parts.push(`(${allMimeTypes.map((t) => `mimeType = '${t}'`).join(' or ')})`)
      break
    }
  }

  return parts.join(' and ')
}

/**
 * The provider segment of every group token a Drive crawl writes. Fixed, and
 * baked into stored ACLs, so it must never change.
 */
const GOOGLE_DRIVE_ACL_PROVIDER_ID = 'google-drive'

interface DriveAclContext {
  providerId: string
  tenantId: string
  policy: OpenSharingPolicy
}

/**
 * The context an admin-mode crawl needs to name the principals on a file: which
 * directory a group belongs to, and how far the admin has opted into open
 * sharing being searchable.
 *
 * The tenant is the impersonated administrator's Workspace domain, derived by
 * the same function the directory sync uses so the two can never disagree.
 * Null when no administrator is configured, which is every crawl that is not
 * mirroring permissions.
 */
function driveAclContext(sourceConfig: Record<string, unknown>): DriveAclContext | null {
  const domain = googleWorkspaceDomain(sourceConfig.adminEmail)
  if (!domain) return null
  const openSharing = sourceConfig.openSharing
  return {
    providerId: GOOGLE_DRIVE_ACL_PROVIDER_ID,
    tenantId: domain,
    policy: {
      domain: openSharing === 'domain' || openSharing === 'anyone',
      anyone: openSharing === 'anyone',
    },
  }
}

/**
 * The file's mirrored ACL, or undefined when this crawl cannot speak for it.
 *
 * Drive sometimes returns fewer expanded permissions than it reports ids for,
 * which is why both are requested. Mirroring the subset that did arrive would
 * store the file under narrower grants than it really has — which sounds like
 * the safe direction but is not, because the grants that went missing are
 * exactly the ones nobody verified. Undefined leaves the file readable by
 * nobody until a crawl sees the whole set.
 */
function fileAcl(file: DriveFile, context: DriveAclContext | null): string[] | undefined {
  if (!context || !file.permissions) return undefined
  if (file.permissionIds && file.permissionIds.length !== file.permissions.length) return undefined
  return driveFileAcl({
    permissions: file.permissions,
    providerId: context.providerId,
    tenantId: context.tenantId,
    policy: context.policy,
    driveId: file.driveId,
  })
}

function fileToStub(file: DriveFile, acl?: string[]): ExternalDocument {
  /**
   * Sheets moved from a first-sheet-only CSV export to the complete XLSX source.
   * The namespace forces one rehydration for existing rows whose old hash would
   * otherwise preserve embeddings that omit every sheet after the first.
   */
  const hashNamespace =
    file.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'gdrive:v2' : 'gdrive'

  return {
    externalId: file.id,
    title: file.name || 'Untitled',
    content: '',
    contentDeferred: true,
    ...(acl ? { acl } : {}),
    mimeType: 'text/plain',
    sourceUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    contentHash: `${hashNamespace}:${file.id}:${file.modifiedTime ?? ''}`,
    metadata: {
      originalMimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      createdTime: file.createdTime,
      owners: file.owners?.map((o) => o.displayName || o.emailAddress).filter(Boolean),
      starred: file.starred,
      fileSize: file.size ? Number(file.size) : undefined,
    },
  }
}

export const googleDriveConnector: ConnectorConfig = {
  ...googleDriveConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const query = buildQuery(sourceConfig, lastSyncAt)
    const pageSize = 100

    const maxFiles = parseMaxFiles(sourceConfig.maxFiles)
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

    if (maxFiles > 0 && previouslyFetched >= maxFiles) {
      return { documents: [], hasMore: false }
    }

    const remaining = maxFiles > 0 ? maxFiles - previouslyFetched : 0
    const effectivePageSize = maxFiles > 0 ? Math.min(pageSize, remaining) : pageSize

    const queryParams = new URLSearchParams({
      q: query,
      pageSize: String(effectivePageSize),
      orderBy: 'modifiedTime desc',
      fields:
        'kind,nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners,size,starred,parents,driveId,permissionIds,permissions(id,type,emailAddress,domain,role,allowFileDiscovery,permittedBy))',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })

    if (cursor) {
      queryParams.set('pageToken', cursor)
    }

    const url = `https://www.googleapis.com/drive/v3/files?${queryParams.toString()}`

    logger.info('Listing Google Drive files', { query, cursor: cursor ?? 'initial' })

    let response: Response
    try {
      response = await fetchGoogleDriveWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })
    } catch (error) {
      logger.error('Failed to list Google Drive files', googleDriveErrorLogFields(error))
      throw error
    }

    const data = parseDriveFileListResponse(await response.json())
    const files = data.files

    /**
     * Drive sets `incompleteSearch` when it could not search every corpus (it
     * arises with the `allDrives` scope enabled by `includeItemsFromAllDrives`).
     * A partial listing drops still-existing files, so reconciliation must be
     * suppressed to avoid hard-deleting valid documents.
     */
    const incompleteSearch = data.incompleteSearch === true

    const aclContext = driveAclContext(sourceConfig)
    const pageDocuments = files
      .filter((f) => isGoogleWorkspaceFile(f.mimeType) || isSupportedTextFile(f.mimeType))
      .map((f) =>
        stubOrSkipBySize(
          fileToStub(f, fileAcl(f, aclContext)),
          Number(f.size) || undefined,
          CONNECTOR_MAX_FILE_BYTES
        )
      )

    const page = takeIndexableWithinCap(
      pageDocuments,
      isSkippedDocument,
      maxFiles,
      previouslyFetched
    )

    const totalFetched = previouslyFetched + page.indexableCount
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = page.capReached

    const nextPageToken = data.nextPageToken

    /**
     * Suppress deletion reconciliation only when the listing really is partial.
     * Drive omits `nextPageToken` once the end of the list is reached, so hitting
     * `maxFiles` on the final page still represents the full source set and must
     * stay reconcilable — otherwise a capped source can never drop deleted files.
     */
    if (syncContext && ((hitLimit && Boolean(nextPageToken)) || incompleteSearch)) {
      syncContext.listingCapped = true
    }

    return {
      documents: page.documents,
      nextCursor: hitLimit ? undefined : nextPageToken,
      hasMore: hitLimit ? false : Boolean(nextPageToken),
      reconciliationSafe: incompleteSearch ? false : undefined,
    }
  },

  openDirectory: async (accessToken, sourceConfig) =>
    openGoogleDirectory(accessToken, sourceConfig.adminEmail),

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const fields =
      'id,name,mimeType,modifiedTime,createdTime,webViewLink,owners,size,starred,trashed'
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(externalId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`

    let response: Response
    try {
      response = await fetchGoogleDriveWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })
    } catch (error) {
      if (!(error instanceof GoogleDriveApiError)) throw error
      if (error.kind === 'not_found') return null
      throw error
    }

    const file = parseDriveFileMetadata(await response.json(), externalId)

    if (file.trashed) return null

    /**
     * Mirrors the listing filter. The marker distinguishes a successfully
     * verified unindexable file from an ambiguous null hydration.
     */
    if (!isGoogleWorkspaceFile(file.mimeType) && !isSupportedTextFile(file.mimeType)) {
      logger.info('Google Drive file has no extractable text type', {
        fileId: file.id,
        mimeType: file.mimeType,
      })
      return {
        ...markSkipped(fileToStub(file), 'File is no longer an indexable document'),
        skippedExistingDisposition: 'replace',
      }
    }

    try {
      const payload = await fetchFilePayload(accessToken, file)
      if (!payload.content.trim() && !payload.sourceFile?.bytes.length) {
        return {
          ...markSkipped(
            { ...fileToStub(file), ...payload },
            'Document contains no extractable text'
          ),
          skippedExistingDisposition: 'replace',
        }
      }

      const stub = fileToStub(file)
      return { ...stub, ...payload, contentDeferred: false }
    } catch (error) {
      if (error instanceof ConnectorFileTooLargeError) {
        logger.info('Skipping oversized Google Drive file', { fileId: file.id, name: file.name })
        return markSkipped(fileToStub(file), sizeLimitSkipReason(error.limitBytes))
      }
      /**
       * The file exists but its content could not be read. Propagate so the engine
       * records a visible failed hydration instead of silently leaving a listed file
       * unindexed (or, on an update, counting a stale copy as unchanged).
       */
      const err = toError(error)
      logger.warn(`Failed to fetch content for file: ${file.name} (${file.id})`, {
        ...googleDriveErrorLogFields(err),
      })
      throw err
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const folderIds = parseMultiValue(sourceConfig.folderId)

    // Verify access to Drive API
    try {
      parseMaxFiles(sourceConfig.maxFiles)

      if (folderIds.length > 0) {
        // Verify each folder exists, is accessible, and is actually a folder
        for (const folderId of folderIds) {
          const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`
          let response: Response
          try {
            response = await fetchGoogleDriveWithRetry(
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
          } catch (error) {
            if (error instanceof GoogleDriveApiError) {
              if (error.kind === 'not_found') {
                return {
                  valid: false,
                  error: `Folder "${folderId}" not found. Check the folder ID and permissions.`,
                }
              }
              return {
                valid: false,
                error: `Failed to access folder "${folderId}": ${error.message}`,
              }
            }
            throw error
          }

          const folder = await response.json()
          if (folder.mimeType !== 'application/vnd.google-apps.folder') {
            return { valid: false, error: `"${folderId}" is not a folder` }
          }
        }
      } else {
        // Verify basic Drive access by listing one file
        const url =
          'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true'
        try {
          await fetchGoogleDriveWithRetry(
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
        } catch (error) {
          if (error instanceof GoogleDriveApiError) {
            return { valid: false, error: `Failed to access Google Drive: ${error.message}` }
          }
          throw error
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const owners = joinTagArray(metadata.owners)
    if (owners) result.owners = owners

    if (typeof metadata.originalMimeType === 'string') {
      const mimeType = metadata.originalMimeType
      if (mimeType.includes('document')) result.fileType = 'Google Doc'
      else if (mimeType.includes('spreadsheet')) result.fileType = 'Google Sheet'
      else if (mimeType.includes('presentation')) result.fileType = 'Google Slides'
      else if (mimeType.startsWith('text/')) result.fileType = 'Text File'
      else result.fileType = mimeType
    }

    const lastModified = parseTagDate(metadata.modifiedTime)
    if (lastModified) result.lastModified = lastModified

    if (typeof metadata.starred === 'boolean') {
      result.starred = metadata.starred
    }

    return result
  },

  /**
   * Drive answers `notFound` for a `parents` query on a folder the caller
   * cannot open, so a member who was never given the folder lists nothing.
   */
  isListingScopeUnavailableError: (error) =>
    error instanceof GoogleDriveApiError && error.kind === 'not_found',

  getChangeCursor: async (accessToken: string): Promise<string> => {
    const url = 'https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true'
    const response = await fetchGoogleDriveWithRetry(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    const data: unknown = await response.json()
    if (
      !isPlainRecord(data) ||
      typeof data.startPageToken !== 'string' ||
      data.startPageToken.length === 0
    ) {
      throw new Error('Google Drive API returned malformed change-cursor metadata')
    }
    return data.startPageToken
  },

  /**
   * Reads `changes.list` for the account behind the token. Drive reports a
   * file the account lost access to with `removed: true`, and a file newly
   * shared with it as an ordinary change, so one feed carries both content
   * and permission changes for that account.
   */
  listChanges: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor: string
  ): Promise<ExternalChangeList> => {
    const queryParams = new URLSearchParams({
      pageToken: cursor,
      pageSize: '100',
      includeRemoved: 'true',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      restrictToMyDrive: 'false',
      spaces: 'drive',
      fields:
        'nextPageToken,newStartPageToken,changes(changeType,removed,fileId,file(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners,size,starred,trashed,parents))',
    })
    const url = `https://www.googleapis.com/drive/v3/changes?${queryParams.toString()}`

    let response: Response
    try {
      response = await fetchGoogleDriveWithRetry(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
    } catch (error) {
      logger.error('Failed to list Google Drive changes', googleDriveErrorLogFields(error))
      throw error
    }

    const data = parseDriveChangeListResponse(await response.json())
    const changes: ExternalChange[] = []
    for (const change of data.changes) {
      const mapped = driveChangeToExternal(change, sourceConfig)
      if (mapped) changes.push(mapped)
    }
    const nextCursor = data.nextPageToken ?? data.newStartPageToken
    if (!nextCursor) {
      throw new Error('Google Drive API returned malformed change-list metadata')
    }
    return { changes, nextCursor, hasMore: Boolean(data.nextPageToken) }
  },

  isChangeCursorInvalidError: isDriveChangeCursorInvalidError,
}
