import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  type DrivePermission,
  driveFileAcl,
  type OpenSharingPolicy,
} from '@/lib/knowledge/access/drive-permissions'
import type { MirroredDocumentAcl } from '@/lib/knowledge/access/types'
import { OCR_IMAGE_MIME_TYPES } from '@/lib/knowledge/documents/ocr-request-policy'
import { VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { drainGooglePagedList } from '@/lib/oauth/google-pagination'
import {
  googleWorkspaceDomain,
  openGoogleDirectory,
  validateGoogleDirectoryAccess,
} from '@/connectors/google-drive/directory'
import {
  fetchGoogleDriveWithRetry,
  GoogleDriveApiError,
} from '@/connectors/google-drive/google-drive-errors'
import {
  GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID,
  GOOGLE_DRIVE_OPEN_SHARING_FIELD_ID,
  googleDriveConnectorMeta,
} from '@/connectors/google-drive/meta'
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
  isPerMemberListing,
  isSkippedDocument,
  joinTagArray,
  markSkipped,
  PIPELINE_PARSED_MIME_TYPES,
  parseMultiValue,
  parseOptionalUnlimitedSafeInteger,
  parseTagDate,
  pipelineParsedMimeType,
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
const SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut'
const SHORTCUT_FETCH_CONCURRENCY = 8
const DRIVE_METADATA_MAX_BYTES = 1024 * 1024
const DRIVE_PAGE_MAX_BYTES = 16 * 1024 * 1024
const DRIVE_FILE_FIELDS =
  'id,name,mimeType,modifiedTime,createdTime,webViewLink,owners,size,starred,trashed,parents,shortcutDetails(targetId,targetMimeType,targetResourceKey)'

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'

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

function rawFileType(file: DriveFile): { mimeType: string; fileName: string } | undefined {
  if (file.mimeType.startsWith('application/vnd.google-apps.')) return undefined
  const byName = pipelineParsedMimeType(file.name)
  if (byName) return { mimeType: byName, fileName: file.name }
  if (OCR_IMAGE_MIME_TYPES.has(file.mimeType)) {
    return { mimeType: file.mimeType, fileName: file.name }
  }
  for (const [extension, mimeType] of PIPELINE_PARSED_MIME_TYPES) {
    if (mimeType === file.mimeType) {
      return { mimeType, fileName: `${file.name}.${extension}` }
    }
  }
  return undefined
}

function isSupportedFile(file: DriveFile): boolean {
  return (
    isGoogleWorkspaceFile(file.mimeType) ||
    isSupportedTextFile(file.mimeType) ||
    rawFileType(file) !== undefined
  )
}

async function exportGoogleWorkspaceFile(
  accessToken: string,
  fileId: string,
  sourceMimeType: string,
  resourceKey?: string
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
      headers: driveRequestHeaders(accessToken, fileId, resourceKey),
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

async function downloadFile(
  accessToken: string,
  fileId: string,
  resourceKey?: string
): Promise<Buffer> {
  // Listing runs with `includeItemsFromAllDrives`, so ids here can belong to a shared
  // drive; `supportsAllDrives` declares that support to `files.get` the same way the
  // metadata fetch in getDocument already does. (`files.export` takes no such param.)
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`

  const response = await fetchGoogleDriveWithRetry(url, {
    method: 'GET',
    headers: driveRequestHeaders(accessToken, fileId, resourceKey),
  })

  // Stream with a hard byte cap so a file with missing/under-reported listing
  // size metadata is never fully buffered into memory. Oversized files raise
  // DriveFileTooLargeError so getDocument can surface them as skipped (failed) rows.
  const buffer = await readBodyWithLimit(response, CONNECTOR_MAX_FILE_BYTES)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(CONNECTOR_MAX_FILE_BYTES)
  }
  return buffer
}

type FilePayload = Pick<ExternalDocument, 'content' | 'mimeType' | 'sourceFile'>

function xlsxFileName(name: string): string {
  return name.toLowerCase().endsWith('.xlsx') ? name : `${name}.xlsx`
}

async function fetchFilePayload(
  accessToken: string,
  file: DriveFile,
  resourceKey?: string
): Promise<FilePayload> {
  if (GOOGLE_WORKSPACE_EXPORTS[file.mimeType]) {
    const bytes = await exportGoogleWorkspaceFile(accessToken, file.id, file.mimeType, resourceKey)
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
    const html = (await downloadFile(accessToken, file.id, resourceKey)).toString('utf8')
    return { content: htmlToPlainText(html), mimeType: 'text/plain' }
  }
  const raw = rawFileType(file)
  if (raw) {
    return {
      content: '',
      mimeType: raw.mimeType,
      sourceFile: { ...raw, bytes: await downloadFile(accessToken, file.id, resourceKey) },
    }
  }
  if (isSupportedTextFile(file.mimeType)) {
    return {
      content: (await downloadFile(accessToken, file.id, resourceKey)).toString('utf8'),
      mimeType: 'text/plain',
    }
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
  shortcutDetails?: { targetId: string; targetMimeType?: string; targetResourceKey?: string }
  /**
   * Absent for a file on a shared drive, and for any file the impersonated
   * administrator cannot share: Drive serves those only through
   * `permissions.list`, which {@link resolveDriveAcls} calls for them.
   */
  permissions?: DrivePermission[]
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
function matchesFileType(fileType: string, file: DriveFile): boolean {
  const { mimeType } = file
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
      return isSupportedFile(file)
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
  if (!matchesFileType((sourceConfig.fileType as string) || 'all', file)) return false
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

function buildQuery(
  sourceConfig: Record<string, unknown>,
  lastSyncAt?: Date,
  includeFolders = false
): string {
  const parts: string[] = ['trashed = false']

  const parentsClause = buildDriveParentsClause(parseMultiValue(sourceConfig.folderId))
  if (parentsClause) parts.push(parentsClause)

  if (lastSyncAt) {
    /** Target edits do not modify the shortcut itself. */
    parts.push(
      `(modifiedTime > '${lastSyncAt.toISOString()}' or mimeType = '${SHORTCUT_MIME_TYPE}')`
    )
  }

  const fileType = (sourceConfig.fileType as string) || 'all'
  const mimeParts: string[] = []
  switch (fileType) {
    case 'documents':
      mimeParts.push("mimeType = 'application/vnd.google-apps.document'")
      break
    case 'spreadsheets':
      mimeParts.push("mimeType = 'application/vnd.google-apps.spreadsheet'")
      break
    case 'presentations':
      mimeParts.push("mimeType = 'application/vnd.google-apps.presentation'")
      break
    case 'text':
      mimeParts.push(...SUPPORTED_TEXT_MIME_TYPES.map((t) => `mimeType = '${t}'`))
      break
    default: {
      /** Uploaded files can have generic MIME metadata; the filename selects the parser. */
      if (!includeFolders) parts.push(`mimeType != '${FOLDER_MIME_TYPE}'`)
      break
    }
  }
  if (mimeParts.length > 0) {
    /** Resolve the current target type: shortcutDetails.targetMimeType can be stale. */
    mimeParts.push(`mimeType = '${SHORTCUT_MIME_TYPE}'`)
    if (includeFolders) mimeParts.push(`mimeType = '${FOLDER_MIME_TYPE}'`)
    parts.push(`(${mimeParts.join(' or ')})`)
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
function driveAclContext(
  sourceConfig: Record<string, unknown>,
  syncContext?: Record<string, unknown>
): DriveAclContext | null {
  /** The engine says whether this run mirrors; the admin says whose eyes it crawls through. */
  if (syncContext && syncContext.mirrorsSourceAcls !== true) return null
  const domain = googleWorkspaceDomain(sourceConfig[GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID])
  if (!domain) return null
  const openSharing = sourceConfig[GOOGLE_DRIVE_OPEN_SHARING_FIELD_ID]
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
 * The file's mirrored ACL from its listing, or undefined when the listing
 * cannot speak for it and {@link resolveDriveAcls} must.
 *
 * Drive leaves `permissions` unpopulated for a file on a shared drive, and for
 * any file the requesting user cannot share. Those go to `permissions.list`,
 * the one endpoint that answers for every file.
 */
function fileAcl(file: DriveFile, context: DriveAclContext | null): string[] | undefined {
  if (!context || !file.permissions) return undefined
  return driveFileAcl({ ...context, permissions: file.permissions })
}

/** Files whose permissions are fetched at once. Bounded to keep a crawl responsive. */
const PERMISSION_FETCH_CONCURRENCY = 8

/** Guards against a file that keeps paginating; far above any real permission list. */
const MAX_PERMISSION_PAGES = 50

/** The permission fields the ACL mapper reads, and nothing more. */
const DRIVE_PERMISSION_FIELDS = 'id,type,emailAddress,domain,role,allowFileDiscovery,deleted'

/**
 * A file's full permission list, from the one endpoint that serves it for every
 * file — including those on a shared drive, whose listing carries none.
 *
 * Throws rather than returning a partial list: a file mirrored under the
 * permissions that happened to arrive is a file whose missing grants nobody
 * verified.
 */
async function listFilePermissions(
  accessToken: string,
  fileId: string,
  resourceKey?: string
): Promise<DrivePermission[]> {
  const { items, truncated } = await drainGooglePagedList<
    DrivePermission,
    { permissions?: DrivePermission[]; nextPageToken?: string }
  >({
    buildUrl: (pageToken) => {
      const query = new URLSearchParams({
        fields: `nextPageToken,permissions(${DRIVE_PERMISSION_FIELDS})`,
        pageSize: '100',
        supportsAllDrives: 'true',
      })
      if (pageToken) query.set('pageToken', pageToken)
      return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${query.toString()}`
    },
    fetch: (url) =>
      fetchGoogleDriveWithRetry(url, {
        method: 'GET',
        headers: driveRequestHeaders(accessToken, fileId, resourceKey),
      }),
    parseError: (response) => response.json().catch(() => null),
    getItems: (body) => body.permissions,
    getNextPageToken: (body) => body.nextPageToken,
    maxPages: MAX_PERMISSION_PAGES,
    label: 'Google Drive permissions',
  })
  if (truncated) {
    throw new Error(`Google Drive permissions exceeded ${MAX_PERMISSION_PAGES} pages`)
  }
  return items
}

/**
 * The ACLs of files whose listing could not describe them — every file on a
 * shared drive, whose listing carries no permissions at all.
 *
 * A file whose permissions cannot be read is omitted, which leaves it readable
 * by nobody until a run can read them: the failure is logged per file and the
 * rest of the batch still resolves.
 */
async function resolveDriveAcls(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  documents: readonly ExternalDocument[],
  syncContext?: Record<string, unknown>
): Promise<Record<string, MirroredDocumentAcl>> {
  const context = driveAclContext(sourceConfig, syncContext)
  if (!context) return {}

  const acls: Record<string, MirroredDocumentAcl> = {}
  await mapWithConcurrency(documents, PERMISSION_FETCH_CONCURRENCY, async (document) => {
    const fileId = document.externalId
    try {
      if (document.metadata?.shortcutTargetId) {
        const file = await readDriveFile(accessToken, fileId, undefined, true)
        if (file.trashed) {
          acls[fileId] = []
          return
        }
        if (file.mimeType === SHORTCUT_MIME_TYPE) {
          const target = await readShortcutTarget(accessToken, file, true)
          acls[fileId] =
            target && isSupportedFile(target.file)
              ? await shortcutAcl(accessToken, file, target.file, context, target.resourceKey)
              : []
          return
        }
        const listedAcl = fileAcl(file, context)
        if (listedAcl) {
          acls[fileId] = listedAcl
          return
        }
      }
      const permissions = await listFilePermissions(accessToken, fileId)
      acls[fileId] = driveFileAcl({ ...context, permissions })
    } catch (error) {
      logger.warn("Could not read a file's permissions; it stays readable by nobody", {
        fileId,
        ...googleDriveErrorLogFields(error),
      })
    }
  })
  return acls
}

function fileToStub(
  file: DriveFile,
  acl?: MirroredDocumentAcl,
  target?: DriveFile
): ExternalDocument {
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
    contentHash: target
      ? `gdrive:shortcut:v1:${file.id}:${file.modifiedTime ?? ''}:${target.id}:${target.modifiedTime ?? ''}:${target.mimeType}`
      : `${hashNamespace}:${file.id}:${file.modifiedTime ?? ''}`,
    metadata: {
      originalMimeType: target?.mimeType ?? file.mimeType,
      ...(target ? { shortcutTargetId: target.id } : {}),
      modifiedTime: target?.modifiedTime ?? file.modifiedTime,
      createdTime: file.createdTime,
      owners: file.owners?.map((o) => o.displayName || o.emailAddress).filter(Boolean),
      starred: file.starred,
      fileSize: (target ?? file).size ? Number((target ?? file).size) : undefined,
    },
  }
}

/** Resource keys are capabilities: send only to Drive, never persist them in document metadata. */
function driveRequestHeaders(
  accessToken: string,
  fileId: string,
  resourceKey?: string
): Record<string, string> {
  if (
    resourceKey !== undefined &&
    (!/^[A-Za-z0-9_-]{1,1024}$/.test(resourceKey) || !/^[A-Za-z0-9_-]{1,1024}$/.test(fileId))
  ) {
    throw new Error('Google Drive returned malformed resource-key metadata')
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${fileId}/${resourceKey}` } : {}),
  }
}

async function readDriveJson(response: Response, limitBytes: number): Promise<unknown> {
  const body = await readBodyWithLimit(response, limitBytes)
  if (!body) throw new Error('Google Drive metadata exceeded its size limit')
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new Error('Google Drive returned malformed metadata')
  }
}

async function readDriveFile(
  accessToken: string,
  fileId: string,
  resourceKey?: string,
  permissions = false
): Promise<DriveFile> {
  const fields = `${DRIVE_FILE_FIELDS}${permissions ? `,permissions(${DRIVE_PERMISSION_FIELDS})` : ''}`
  const response = await fetchGoogleDriveWithRetry(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`,
    { method: 'GET', headers: driveRequestHeaders(accessToken, fileId, resourceKey) }
  )
  return parseDriveFileMetadata(await readDriveJson(response, DRIVE_METADATA_MAX_BYTES), fileId)
}

/** Resolve one current file target; folder traversal and shortcut chains are not expanded. */
async function readShortcutTarget(
  accessToken: string,
  shortcut: DriveFile,
  permissions = false
): Promise<{ file: DriveFile; resourceKey?: string } | null> {
  const details = shortcut.shortcutDetails
  if (
    !details ||
    typeof details.targetId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,1024}$/.test(details.targetId) ||
    (details.targetResourceKey !== undefined && typeof details.targetResourceKey !== 'string')
  ) {
    throw new Error('Google Drive returned malformed shortcut metadata')
  }
  if (details.targetId === shortcut.id) throw new Error('Google Drive returned a cyclic shortcut')
  try {
    const file = await readDriveFile(
      accessToken,
      details.targetId,
      details.targetResourceKey,
      permissions
    )
    if (!file.trashed && !isDriveFileListItem(file)) {
      throw new Error('Google Drive returned malformed shortcut target metadata')
    }
    return file.trashed ? null : { file, resourceKey: details.targetResourceKey }
  } catch (error) {
    if (
      error instanceof GoogleDriveApiError &&
      (error.kind === 'not_found' || error.kind === 'permission')
    )
      return null
    throw error
  }
}

function unavailableShortcut(file: DriveFile): ExternalDocument {
  return {
    ...markSkipped(
      fileToStub(file, []),
      'Shortcut target is unavailable or the connector account cannot access it'
    ),
    skippedExistingDisposition: 'replace',
  }
}

/** A shortcut's own grants never grant access to its target's content. */
async function shortcutAcl(
  accessToken: string,
  shortcut: DriveFile,
  target: DriveFile,
  context: DriveAclContext,
  resourceKey?: string
): Promise<MirroredDocumentAcl> {
  return {
    acl:
      fileAcl(shortcut, context) ??
      driveFileAcl({
        ...context,
        permissions: await listFilePermissions(accessToken, shortcut.id),
      }),
    requirements: [
      fileAcl(target, context) ??
        driveFileAcl({
          ...context,
          permissions: await listFilePermissions(accessToken, target.id, resourceKey),
        }),
    ],
  }
}

async function listedFileToDocument(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  file: DriveFile,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocument | null> {
  if (file.trashed || file.mimeType === FOLDER_MIME_TYPE) return null
  const context = driveAclContext(sourceConfig, syncContext)
  let target: DriveFile | undefined
  let acl: MirroredDocumentAcl | undefined = fileAcl(file, context)
  if (file.mimeType === SHORTCUT_MIME_TYPE) {
    let resolved: Awaited<ReturnType<typeof readShortcutTarget>>
    try {
      resolved = await readShortcutTarget(accessToken, file, Boolean(context))
    } catch (error) {
      /** Member visibility requires verified target access; a failed page never grants it. */
      if (isPerMemberListing(syncContext)) throw error
      logger.warn(
        'Could not resolve shortcut target; deferring to content hydration',
        googleDriveErrorLogFields(error)
      )
      return fileToStub(file, [])
    }
    if (!resolved) return isPerMemberListing(syncContext) ? null : unavailableShortcut(file)
    target = resolved.file
    if (context) {
      try {
        acl = await shortcutAcl(accessToken, file, target, context, resolved.resourceKey)
      } catch (error) {
        logger.warn(
          'Could not verify shortcut and target permissions',
          googleDriveErrorLogFields(error)
        )
        acl = []
      }
    }
  }
  const contentFile = target ?? file
  if (!matchesFileType((sourceConfig.fileType as string) || 'all', contentFile)) return null
  return stubOrSkipBySize(
    fileToStub(file, acl, target),
    Number(contentFile.size) || undefined,
    CONNECTOR_MAX_FILE_BYTES
  )
}

const SHORTCUT_CHANGE_CURSOR_PREFIX = 'gdrive-shortcuts:v1:'
interface ShortcutChangeCursor {
  resume: string
  pageToken?: string
}

function writeShortcutChangeCursor(cursor: ShortcutChangeCursor): string {
  return `${SHORTCUT_CHANGE_CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor)).toString('base64url')}`
}

function readShortcutChangeCursor(cursor: string): ShortcutChangeCursor | undefined {
  if (!cursor.startsWith(SHORTCUT_CHANGE_CURSOR_PREFIX)) return undefined
  try {
    if (cursor.length > 65536) throw new Error()
    const value: unknown = JSON.parse(
      Buffer.from(cursor.slice(SHORTCUT_CHANGE_CURSOR_PREFIX.length), 'base64url').toString('utf8')
    )
    if (
      !isPlainRecord(value) ||
      typeof value.resume !== 'string' ||
      !value.resume ||
      value.resume.length > 16384 ||
      (value.pageToken !== undefined &&
        (typeof value.pageToken !== 'string' || !value.pageToken || value.pageToken.length > 16384))
    )
      throw new Error()
    return { resume: value.resume, pageToken: value.pageToken }
  } catch {
    throw new InvalidDriveListingCursor('Google Drive shortcut listing must restart')
  }
}

/** Target edits and revocations need not emit a change for their shortcuts. */
async function listShortcutChanges(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  cursor: ShortcutChangeCursor
): Promise<ExternalChangeList> {
  const params = new URLSearchParams({
    q: `trashed = false and mimeType = '${SHORTCUT_MIME_TYPE}'`,
    orderBy: 'createdTime',
    fields: `kind,nextPageToken,incompleteSearch,files(${DRIVE_FILE_FIELDS})`,
    pageSize: '100',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })
  if (cursor.pageToken) params.set('pageToken', cursor.pageToken)
  const response = await fetchGoogleDriveWithRetry(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    }
  )
  const page = parseDriveFileListResponse(await readDriveJson(response, DRIVE_PAGE_MAX_BYTES))
  if (page.incompleteSearch) throw new Error('Google Drive shortcut search was incomplete')
  if (page.nextPageToken && page.nextPageToken === cursor.pageToken)
    throw new Error('Google Drive repeated a shortcut continuation token')
  const changes = await mapWithConcurrency(
    page.files,
    SHORTCUT_FETCH_CONCURRENCY,
    async (file): Promise<ExternalChange> => {
      const document = await listedFileToDocument(accessToken, sourceConfig, file, {
        perMemberListing: true,
      })
      return document
        ? { kind: 'upsert', externalId: file.id, document }
        : { kind: 'removed', externalId: file.id }
    }
  )
  return {
    changes,
    nextCursor: page.nextPageToken
      ? writeShortcutChangeCursor({ ...cursor, pageToken: page.nextPageToken })
      : cursor.resume,
    hasMore: Boolean(page.nextPageToken),
  }
}

const TREE_CURSOR_PREFIX = 'gdrive-tree:1:'
const MAX_TREE_CURSOR_BYTES = 512 * 1024
const MAX_PENDING_FOLDERS = 10_000
const MAX_FOLDER_DEPTH = 128

interface FolderPage {
  id: string
  depth: number
  pageToken?: string
}

interface FolderTraversal {
  pending: FolderPage[]
  totalFetched: number
}

class InvalidDriveListingCursor extends Error {}

/** Each continuation contains only pending folder pages, never document payloads. */
function readTraversal(cursor: string, roots: string[]): FolderTraversal {
  try {
    if (!cursor.startsWith(TREE_CURSOR_PREFIX) || cursor.length > MAX_TREE_CURSOR_BYTES) {
      throw new Error()
    }
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor.slice(TREE_CURSOR_PREFIX.length), 'base64url').toString('utf8')
    )
    if (
      !isPlainRecord(parsed) ||
      !Array.isArray(parsed.pending) ||
      parsed.pending.length === 0 ||
      parsed.pending.length > MAX_PENDING_FOLDERS ||
      typeof parsed.totalFetched !== 'number' ||
      !Number.isSafeInteger(parsed.totalFetched) ||
      parsed.totalFetched < 0
    ) {
      throw new Error()
    }
    const pending: FolderPage[] = parsed.pending.map((frame: unknown) => {
      if (
        !isPlainRecord(frame) ||
        typeof frame.id !== 'string' ||
        frame.id.length === 0 ||
        frame.id.length > 512 ||
        typeof frame.depth !== 'number' ||
        !Number.isInteger(frame.depth) ||
        frame.depth < 0 ||
        frame.depth > MAX_FOLDER_DEPTH ||
        (frame.depth === 0 && !roots.includes(frame.id)) ||
        (frame.pageToken !== undefined &&
          (typeof frame.pageToken !== 'string' ||
            frame.pageToken.length === 0 ||
            frame.pageToken.length > 16384))
      ) {
        throw new Error()
      }
      return { id: frame.id, depth: frame.depth, pageToken: frame.pageToken }
    })
    return { pending, totalFetched: parsed.totalFetched }
  } catch {
    throw new InvalidDriveListingCursor('Google Drive folder listing must restart')
  }
}

function writeTraversal(state: FolderTraversal): string {
  if (state.pending.length > MAX_PENDING_FOLDERS) {
    throw new Error('Google Drive folder traversal exceeded its pending-folder limit')
  }
  const cursor = `${TREE_CURSOR_PREFIX}${Buffer.from(JSON.stringify(state)).toString('base64url')}`
  if (cursor.length > MAX_TREE_CURSOR_BYTES) {
    throw new Error('Google Drive folder traversal exceeded its continuation-size limit')
  }
  return cursor
}

export const googleDriveConnector: ConnectorConfig = {
  isCredentialInvalidError: (error) => error instanceof GoogleDriveApiError && error.status === 401,
  ...googleDriveConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const roots = [...new Set(parseMultiValue(sourceConfig.folderId))]
    const traversal: FolderTraversal | undefined = roots.length
      ? cursor
        ? readTraversal(cursor, roots)
        : { pending: roots.map((id) => ({ id, depth: 0 })), totalFetched: 0 }
      : undefined
    const folder = traversal?.pending.pop()
    /** Folder moves affect descendants without changing their modified timestamps. */
    const query = buildQuery(
      folder ? { ...sourceConfig, folderId: folder.id } : sourceConfig,
      folder ? undefined : lastSyncAt,
      Boolean(folder)
    )
    const pageSize = 100

    const maxFiles = parseMaxFiles(sourceConfig.maxFiles)
    const previouslyFetched =
      traversal?.totalFetched ?? (syncContext?.totalDocsFetched as number) ?? 0

    if (maxFiles > 0 && previouslyFetched >= maxFiles) {
      return { documents: [], hasMore: false }
    }

    const remaining = maxFiles > 0 ? maxFiles - previouslyFetched : 0
    const effectivePageSize = maxFiles > 0 ? Math.min(pageSize, remaining) : pageSize

    const aclContext = driveAclContext(sourceConfig, syncContext)
    const queryParams = new URLSearchParams({
      q: query,
      pageSize: String(effectivePageSize),
      orderBy: 'modifiedTime desc',
      /**
       * Permissions ride along only where the run mirrors them. Every other
       * crawl would pull a permission array per file and discard it.
       */
      fields: `kind,nextPageToken,incompleteSearch,files(${DRIVE_FILE_FIELDS}${
        aclContext ? `,permissions(${DRIVE_PERMISSION_FIELDS})` : ''
      })`,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })

    const pageToken = folder ? folder.pageToken : cursor
    if (pageToken) {
      queryParams.set('pageToken', pageToken)
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
      if (
        traversal &&
        isPerMemberListing(syncContext) &&
        error instanceof GoogleDriveApiError &&
        (error.kind === 'not_found' || error.kind === 'permission')
      ) {
        return {
          documents: [],
          hasMore: traversal.pending.length > 0,
          nextCursor: traversal.pending.length ? writeTraversal(traversal) : undefined,
        }
      }
      logger.error('Failed to list Google Drive files', googleDriveErrorLogFields(error))
      throw error
    }

    const data = parseDriveFileListResponse(await readDriveJson(response, DRIVE_PAGE_MAX_BYTES))
    const files = data.files

    /**
     * Drive sets `incompleteSearch` when it could not search every corpus (it
     * arises with the `allDrives` scope enabled by `includeItemsFromAllDrives`).
     * A partial listing drops still-existing files, so reconciliation must be
     * suppressed to avoid hard-deleting valid documents.
     */
    const incompleteSearch = data.incompleteSearch === true

    if (traversal && folder) {
      if (data.nextPageToken) {
        if (data.nextPageToken === folder.pageToken) {
          throw new Error('Google Drive repeated a folder continuation token')
        }
        traversal.pending.push({ ...folder, pageToken: data.nextPageToken })
      }
      const children = [
        ...new Set(
          files.filter((file) => file.mimeType === FOLDER_MIME_TYPE).map((file) => file.id)
        ),
      ]
      for (const id of children) {
        /** An explicitly selected descendant is walked as its own root. */
        if (roots.includes(id)) continue
        if (folder.depth >= MAX_FOLDER_DEPTH) {
          throw new Error('Google Drive folder traversal exceeded its nesting-depth limit')
        }
        traversal.pending.push({ id, depth: folder.depth + 1 })
      }
    }

    const resolved = await mapWithConcurrency(files, SHORTCUT_FETCH_CONCURRENCY, (file) =>
      listedFileToDocument(accessToken, sourceConfig, file, syncContext)
    )
    const pageDocuments = resolved.filter((doc): doc is ExternalDocument => doc !== null)

    const page = takeIndexableWithinCap(
      pageDocuments,
      isSkippedDocument,
      maxFiles,
      previouslyFetched
    )

    const totalFetched = previouslyFetched + page.indexableCount
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    if (traversal) traversal.totalFetched = totalFetched
    const hitLimit = page.capReached

    const nextPageToken = traversal
      ? traversal.pending.length
        ? writeTraversal(traversal)
        : undefined
      : data.nextPageToken

    /**
     * Suppress deletion reconciliation only when the listing really is partial.
     * Drive omits `nextPageToken` once the end of the list is reached, so hitting
     * `maxFiles` on the final page still represents the full source set and must
     * stay reconcilable — otherwise a capped source can never drop deleted files.
     */
    if (
      syncContext &&
      ((hitLimit && (Boolean(nextPageToken) || page.documents.length < pageDocuments.length)) ||
        incompleteSearch)
    ) {
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
    openGoogleDirectory(
      GOOGLE_DRIVE_ACL_PROVIDER_ID,
      accessToken,
      sourceConfig[GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID]
    ),

  getDocumentAcls: (accessToken, sourceConfig, documents, syncContext) =>
    resolveDriveAcls(accessToken, sourceConfig, documents, syncContext),

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    let file: DriveFile
    try {
      file = await readDriveFile(accessToken, externalId)
    } catch (error) {
      if (error instanceof GoogleDriveApiError && error.kind === 'not_found') return null
      throw error
    }
    if (file.trashed) return null
    let contentFile = file
    let resourceKey: string | undefined
    if (file.mimeType === SHORTCUT_MIME_TYPE) {
      const resolved = await readShortcutTarget(accessToken, file)
      if (!resolved) return unavailableShortcut(file)
      contentFile = resolved.file
      resourceKey = resolved.resourceKey
    }
    const stub = fileToStub(file, undefined, contentFile === file ? undefined : contentFile)

    /**
     * Mirrors the listing filter. The marker distinguishes a successfully
     * verified unindexable file from an ambiguous null hydration.
     */
    if (!matchesFileType((sourceConfig.fileType as string) || 'all', contentFile)) {
      logger.info('Google Drive file has no extractable text type', {
        fileId: file.id,
        mimeType: file.mimeType,
      })
      return {
        ...markSkipped(stub, 'File is no longer an indexable document'),
        skippedExistingDisposition: 'replace',
      }
    }

    try {
      const payload = await fetchFilePayload(accessToken, contentFile, resourceKey)
      if (!payload.content.trim() && !payload.sourceFile?.bytes.length) {
        return {
          ...markSkipped({ ...stub, ...payload }, 'Document contains no extractable text'),
          skippedExistingDisposition: 'replace',
        }
      }

      return { ...stub, ...payload, contentDeferred: false }
    } catch (error) {
      if (error instanceof ConnectorFileTooLargeError) {
        logger.info('Skipping oversized Google Drive file', { fileId: file.id, name: file.name })
        return markSkipped(stub, sizeLimitSkipReason(error.limitBytes))
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
    sourceConfig: Record<string, unknown>,
    syncContext?: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const folderIds = parseMultiValue(sourceConfig.folderId)

    try {
      parseMaxFiles(sourceConfig.maxFiles)
      if (syncContext?.mirrorsSourceAcls === true) {
        await validateGoogleDirectoryAccess(
          accessToken,
          sourceConfig[GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID]
        )
      }

      if (folderIds.length > 0) {
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

  /** Drive does not emit descendant changes when a folder moves into or out of scope. */
  supportsChangeFeed: (sourceConfig) => parseMultiValue(sourceConfig.folderId).length === 0,

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
    const shortcutCursor = readShortcutChangeCursor(cursor)
    if (shortcutCursor) {
      return listShortcutChanges(accessToken, sourceConfig, shortcutCursor)
    }
    const queryParams = new URLSearchParams({
      pageToken: cursor,
      pageSize: '100',
      includeRemoved: 'true',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      restrictToMyDrive: 'false',
      spaces: 'drive',
      fields: `nextPageToken,newStartPageToken,changes(changeType,removed,fileId,file(${DRIVE_FILE_FIELDS}))`,
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

    const data = parseDriveChangeListResponse(await readDriveJson(response, DRIVE_PAGE_MAX_BYTES))
    const mappedChanges = await mapWithConcurrency(
      data.changes,
      SHORTCUT_FETCH_CONCURRENCY,
      async (change) => {
        if (!change.removed && change.file?.mimeType === SHORTCUT_MIME_TYPE) {
          const document = await listedFileToDocument(accessToken, sourceConfig, change.file, {
            perMemberListing: true,
          })
          return document
            ? { kind: 'upsert' as const, externalId: change.fileId!, document }
            : { kind: 'removed' as const, externalId: change.fileId! }
        }
        return driveChangeToExternal(change, sourceConfig)
      }
    )
    const changes = mappedChanges.filter((change): change is ExternalChange => change !== null)
    const nextCursor = data.nextPageToken ?? data.newStartPageToken
    if (!nextCursor) {
      throw new Error('Google Drive API returned malformed change-list metadata')
    }
    return {
      changes,
      nextCursor: data.nextPageToken ?? writeShortcutChangeCursor({ resume: nextCursor }),
      hasMore: true,
    }
  },

  isChangeCursorInvalidError: (error) =>
    error instanceof InvalidDriveListingCursor || isDriveChangeCursorInvalidError(error),
  isListingCursorInvalidError: (error) =>
    error instanceof InvalidDriveListingCursor || isDriveChangeCursorInvalidError(error),
}
