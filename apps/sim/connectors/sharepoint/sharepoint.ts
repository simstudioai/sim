import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import {
  fetchWithRetry,
  readBoundedHttpErrorBody,
  VALIDATE_RETRY_OPTIONS,
} from '@/lib/knowledge/documents/utils'
import { sharepointConnectorMeta } from '@/connectors/sharepoint/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  appendPendingMicrosoftGraphFolders,
  assertMicrosoftGraphNextLink,
  CONNECTOR_MAX_FILE_BYTES,
  ConnectorFileTooLargeError,
  connectorFileExtension,
  decodeMicrosoftGraphTraversalCursor,
  encodeMicrosoftGraphTraversalCursor,
  extractConnectorText,
  hasIndexablePayload,
  isIndexableConnectorFile,
  isSkippedDocument,
  MICROSOFT_GRAPH_MAX_PENDING_FOLDERS,
  type MicrosoftGraphTraversalState,
  markSkipped,
  parseTagDate,
  pipelineParsedMimeType,
  readBodyWithLimit,
  sizeLimitSkipReason,
  stubOrSkipBySize,
  takeIndexableWithinCap,
} from '@/connectors/utils'

const logger = createLogger('SharePointConnector')

const GRAPH_API_ORIGIN = 'https://graph.microsoft.com'
const GRAPH_BASE = `${GRAPH_API_ORIGIN}/v1.0`

const MAX_DOWNLOAD_SIZE = CONNECTOR_MAX_FILE_BYTES

/** Distinct extensions named in the per-page skipped-file diagnostic. */
const MAX_LOGGED_SKIPPED_EXTENSIONS = 10

/**
 * The exact driveItem fields the stub is built from. Graph returns the full
 * driveItem otherwise, which is an order of magnitude larger per item.
 */
const ITEM_SELECT =
  'id,name,webUrl,size,file,folder,lastModifiedDateTime,createdDateTime,createdBy,parentReference'

/**
 * Folder pages listed within a single `listDocuments` call. The sync engine caps
 * a sync at a fixed number of `listDocuments` pages, and a depth-first walk needs
 * at least one request per folder — draining several folders per call keeps a
 * library with thousands of folders from silently truncating its listing.
 */
const MAX_LIST_REQUESTS_PER_CALL = 25

/**
 * Maximum breadth retained by the depth-first library walk.
 *
 * A library page can contribute 200 folders, and the sync engine may request
 * 12,500 Graph pages in one run. Without this guard a folder-heavy tenant can
 * retain millions of IDs and serialize them into a multi-megabyte cursor before
 * yielding one document. Exceeding the bound fails visibly so users can scope
 * the connector to a narrower library or folder.
 */
export const SHAREPOINT_MAX_PENDING_FOLDERS = MICROSOFT_GRAPH_MAX_PENDING_FOLDERS

function parseMaxFiles(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Max files must be a positive safe integer, or 0 for unlimited')
  }
  const normalized = typeof value === 'string' ? value.trim() : value
  if (normalized === '') return 0
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) {
    throw new Error('Max files must be a positive safe integer, or 0 for unlimited')
  }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Max files must be a positive safe integer, or 0 for unlimited')
  }
  return parsed
}

/** Microsoft Graph drive item shape (subset of fields we use). */
interface DriveItem {
  id: string
  name: string
  webUrl?: string
  size?: number
  file?: { mimeType?: string }
  folder?: { childCount?: number }
  lastModifiedDateTime?: string
  createdDateTime?: string
  createdBy?: { user?: { displayName?: string } }
  parentReference?: { path?: string; siteId?: string }
}

interface DriveItemListResponse {
  value: DriveItem[]
  '@odata.nextLink'?: string
}

/** Microsoft Graph drive (document library) shape (subset of fields we use). */
interface Drive {
  id: string
  name?: string
  webUrl?: string
}

interface DriveListResponse {
  value: Drive[]
  '@odata.nextLink'?: string
}

/** A configured folder path resolved to a concrete drive and starting folder. */
interface ResolvedFolderTarget {
  driveId: string
  driveName: string
  /** Undefined when the sync starts at the drive root. */
  folderId?: string
}

type RetryOptions = Parameters<typeof fetchWithRetry>[2]

/**
 * Asserts a request URL points at Microsoft Graph before it is followed with the
 * bearer token in the `Authorization` header. Several callers pass a
 * server-supplied `@odata.nextLink` — one of which round-trips through the sync
 * cursor — so an off-origin link would otherwise hand the access token to a third
 * party. Mirrors `assertGraphNextPageUrl` used by the Graph tool routes.
 */
function assertGraphUrl(url: string): string {
  return assertMicrosoftGraphNextLink(url)
}

/**
 * Issues an authenticated Graph GET. Non-OK responses are returned as-is so
 * callers can distinguish 404 (not found) from a genuine failure.
 */
function graphGet(
  url: string,
  accessToken: string,
  retryOptions?: RetryOptions
): Promise<Response> {
  return fetchWithRetry(
    assertGraphUrl(url),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    retryOptions
  )
}

/**
 * Splits a SharePoint site URL into its hostname and server-relative site path,
 * e.g. "contoso.sharepoint.com/sites/hr" → { hostname, serverRelativePath: "/sites/hr" }.
 * A root site yields an empty server-relative path.
 */
function splitSiteUrl(siteUrl: string): { hostname: string; serverRelativePath: string } {
  const cleaned = siteUrl
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
  const firstSlash = cleaned.indexOf('/')
  if (firstSlash === -1) {
    return { hostname: cleaned, serverRelativePath: '' }
  }
  const segments = toPathSegments(cleaned.slice(firstSlash))
  return {
    hostname: cleaned.slice(0, firstSlash),
    serverRelativePath: segments.length > 0 ? `/${segments.join('/')}` : '',
  }
}

/**
 * Resolves a SharePoint site URL like "contoso.sharepoint.com/sites/mysite"
 * into a Microsoft Graph siteId.
 */
async function resolveSiteId(
  accessToken: string,
  siteUrl: string,
  retryOptions?: RetryOptions
): Promise<{ id: string; displayName: string }> {
  const { hostname, serverRelativePath } = splitSiteUrl(siteUrl)

  // Graph endpoint: GET /sites/{hostname}:/{path}
  const url = serverRelativePath
    ? `${GRAPH_BASE}/sites/${hostname}:${serverRelativePath}`
    : `${GRAPH_BASE}/sites/${hostname}`

  const response = await graphGet(url, accessToken, retryOptions)

  if (!response.ok) {
    const errorText = await readBoundedHttpErrorBody(response)
    throw new Error(
      `Failed to resolve SharePoint site "${siteUrl}": ${response.status} – ${errorText}`
    )
  }

  const site = (await response.json()) as { id: string; displayName?: string }
  logger.info('Resolved SharePoint site', {
    siteUrl,
    siteId: site.id,
    displayName: site.displayName,
  })
  return { id: site.id, displayName: site.displayName ?? '' }
}

/**
 * Downloads the raw bytes of a drive item.
 */
async function downloadFileContent(
  accessToken: string,
  driveId: string,
  itemId: string,
  fileName: string
): Promise<Buffer> {
  const url = `${GRAPH_BASE}/drives/${driveId}/items/${encodeURIComponent(itemId)}/content`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Failed to download file "${fileName}" (${itemId}): ${response.status}`)
  }

  // Stream with a hard byte cap so a file with missing/under-reported listing
  // size metadata is never fully buffered into memory. Oversized files are
  // skipped (returned empty) rather than indexed as truncated partial content.
  const buffer = await readBodyWithLimit(response, MAX_DOWNLOAD_SIZE)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(MAX_DOWNLOAD_SIZE)
  }
  return buffer
}

/**
 * Fetches a file and extracts its indexable text — a UTF-8 decode for text
 * formats, and the shared knowledge-base parsers for Office documents and PDFs.
 */
async function fetchFilePayload(
  accessToken: string,
  driveId: string,
  itemId: string,
  fileName: string
): Promise<Pick<ExternalDocument, 'content' | 'sourceFile' | 'mimeType'>> {
  const buffer = await downloadFileContent(accessToken, driveId, itemId, fileName)

  const mimeType = pipelineParsedMimeType(fileName)
  if (mimeType) {
    return { content: '', mimeType, sourceFile: { bytes: buffer, fileName, mimeType } }
  }

  return { content: extractConnectorText(buffer, fileName), mimeType: 'text/plain' }
}

/**
 * Converts a DriveItem to a lightweight metadata stub (no content download).
 */
function itemToStub(item: DriveItem, siteName: string): ExternalDocument {
  return {
    externalId: item.id,
    title: item.name || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: item.webUrl,
    contentHash: `sharepoint:${item.id}:${item.lastModifiedDateTime ?? ''}`,
    metadata: {
      lastModifiedDateTime: item.lastModifiedDateTime,
      createdDateTime: item.createdDateTime,
      createdBy: item.createdBy?.user?.displayName,
      fileSize: item.size,
      path: item.parentReference?.path,
      siteName,
    },
  }
}

/**
 * Lists items in a folder. When folderId is omitted the root of the drive is listed.
 */
async function listFolderItems(
  accessToken: string,
  driveId: string,
  folderId?: string,
  nextLink?: string
): Promise<DriveItemListResponse> {
  const url =
    nextLink ??
    (folderId
      ? `${GRAPH_BASE}/drives/${driveId}/items/${folderId}/children?$top=200&$select=${ITEM_SELECT}`
      : `${GRAPH_BASE}/drives/${driveId}/root/children?$top=200&$select=${ITEM_SELECT}`)

  const response = await graphGet(url, accessToken)

  if (!response.ok) {
    const errorText = await readBoundedHttpErrorBody(response)
    throw new Error(`Failed to list folder items: ${response.status} – ${errorText}`)
  }

  return response.json() as Promise<DriveItemListResponse>
}

/**
 * Folder-path resolution is layered, and every layer after the first only runs
 * once the previous one has returned 404. The first layer is byte-exact path
 * addressing against the site's default document library — identical to the
 * behaviour that shipped before drive-aware resolution existed — so any
 * configuration that resolves today keeps resolving to the same item.
 */

/** Bounds the children walk so a pathological library cannot spin forever. */
const MAX_CHILD_PAGES_PER_SEGMENT = 50

/** Number of sibling names quoted back in a "folder not found" error. */
const MAX_SUGGESTED_NAMES = 25

/** Bounds the paged document-library listing so a bad cursor cannot spin forever. */
const MAX_DRIVE_PAGES = 20

/**
 * Folds away the differences that make a visually-correct folder name fail
 * byte-exact path addressing: Unicode composition, invisible characters, and
 * whitespace variants (a non-breaking space renders identically to a space).
 * Case is folded because SharePoint item names are themselves case-insensitive —
 * two siblings cannot differ by case alone, so this cannot merge distinct items.
 */
export function normalizeSegment(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Splits a slash-separated path into non-empty, trimmed segments.
 *
 * Dot segments are dropped rather than passed through. Every segment list here
 * ends up concatenated into a Graph URL that `assertGraphUrl` parses with `new
 * URL`, which resolves `..` against the Graph base and would silently retarget
 * the request at an unrelated Graph resource. SharePoint does not allow an item
 * named "." or "..", so nothing addressable is lost.
 */
function toPathSegments(path: string): string[] {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function encodePathSegments(segments: string[]): string {
  return segments.map(encodeURIComponent).join('/')
}

/**
 * Fetches a drive item by its path relative to the drive root. Returns null on
 * 404 so callers can fall through to the next resolution layer. An empty
 * segment list addresses the drive root itself.
 */
async function getItemByPath(
  accessToken: string,
  driveId: string,
  segments: string[],
  retryOptions?: RetryOptions
): Promise<DriveItem | null> {
  const url =
    segments.length === 0
      ? `${GRAPH_BASE}/drives/${driveId}/root`
      : `${GRAPH_BASE}/drives/${driveId}/root:/${encodePathSegments(segments)}`

  const response = await graphGet(url, accessToken, retryOptions)

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Failed to resolve folder path: ${response.status}`)
  }

  return (await response.json()) as DriveItem
}

/**
 * Lists every child folder of a drive item, following pagination.
 */
async function listChildFolders(
  accessToken: string,
  driveId: string,
  parentId: string | undefined,
  retryOptions?: RetryOptions
): Promise<DriveItem[]> {
  const folders: DriveItem[] = []
  let url = parentId
    ? `${GRAPH_BASE}/drives/${driveId}/items/${parentId}/children?$top=200&$select=id,name,folder`
    : `${GRAPH_BASE}/drives/${driveId}/root/children?$top=200&$select=id,name,folder`

  for (let page = 0; page < MAX_CHILD_PAGES_PER_SEGMENT; page++) {
    const response = await graphGet(url, accessToken, retryOptions)
    if (response.status === 404) break
    if (!response.ok) {
      throw new Error(`Failed to list folder contents: ${response.status}`)
    }

    const data = (await response.json()) as DriveItemListResponse
    for (const item of data.value) {
      if (item.folder) folders.push(item)
    }

    const nextLink = data['@odata.nextLink']
    if (!nextLink) break
    url = nextLink
  }

  return folders
}

/**
 * Walks a path segment by segment, matching each against the child folder names
 * under normalization. Returns null when a segment has no match. Throws when a
 * segment matches more than one sibling, rather than silently picking one.
 */
async function walkPathByChildren(
  accessToken: string,
  driveId: string,
  segments: string[],
  retryOptions?: RetryOptions
): Promise<DriveItem | null> {
  let current: DriveItem | null = null

  for (const segment of segments) {
    const children = await listChildFolders(accessToken, driveId, current?.id, retryOptions)
    const target = normalizeSegment(segment)
    const matches = children.filter((child) => normalizeSegment(child.name) === target)

    if (matches.length === 0) return null
    if (matches.length > 1) {
      const names = matches.map((match) => `"${match.name}"`).join(', ')
      throw new Error(
        `Folder path segment "${segment}" matches more than one folder (${names}). Rename one of them or use a more specific path.`
      )
    }

    current = matches[0]
  }

  return current
}

/**
 * Extracts a document-library-relative path from a SharePoint URL. Handles both
 * an address-bar library URL and the "?id=" form that SharePoint produces when
 * copying a link to a folder. Returns null when the URL is a tokenized sharing
 * link, whose target can only be resolved through an endpoint requiring write
 * scopes this connector deliberately does not request.
 */
export function serverRelativePathFromUrl(rawUrl: string, siteUrl: string): string[] | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(
      `"${rawUrl}" is not a valid URL. Enter a folder path relative to the document library, or paste the folder URL from your browser's address bar.`
    )
  }

  if (/^\/:[a-z]:\//i.test(url.pathname)) return null

  const idParam = url.searchParams.get('id')
  const rawPath = idParam ?? decodeURIComponent(url.pathname)

  let segments = toPathSegments(rawPath)

  const { serverRelativePath } = splitSiteUrl(siteUrl)
  const siteSegments = toPathSegments(serverRelativePath)
  const sitePrefixMatches = siteSegments.every(
    (segment, index) => normalizeSegment(segments[index] ?? '') === normalizeSegment(segment)
  )
  if (siteSegments.length > 0 && sitePrefixMatches) {
    segments = segments.slice(siteSegments.length)
  }

  const formsIndex = segments.findIndex((segment) => normalizeSegment(segment) === 'forms')
  if (formsIndex !== -1) {
    segments = segments.slice(0, formsIndex)
  }

  return segments
}

/**
 * Resolves the configured folder path to a concrete drive and folder.
 *
 * Layers, each attempted only after the previous returned no match:
 * 1. Byte-exact path addressing against the site's default document library.
 * 2. The same path re-interpreted with a leading document-library name (the
 *    library is addressed directly; the remainder is the drive-relative path).
 * 3. A normalized, segment-by-segment children walk of both candidates, which
 *    recovers names carrying invisible or non-breaking whitespace.
 */
export async function resolveFolderTarget(
  accessToken: string,
  siteId: string,
  siteUrl: string,
  siteName: string,
  rawFolderPath: string | undefined,
  retryOptions?: RetryOptions
): Promise<ResolvedFolderTarget> {
  const defaultDriveResponse = await graphGet(
    `${GRAPH_BASE}/sites/${siteId}/drive?$select=id,name,webUrl`,
    accessToken,
    retryOptions
  )
  if (!defaultDriveResponse.ok) {
    throw new Error(
      `Failed to open the default document library for site "${siteUrl}": ${defaultDriveResponse.status}`
    )
  }
  const defaultDrive = (await defaultDriveResponse.json()) as Drive
  const defaultDriveName = defaultDrive.name || 'Documents'

  const trimmed = rawFolderPath?.trim()
  if (!trimmed) {
    return { driveId: defaultDrive.id, driveName: defaultDriveName }
  }

  let segments: string[]
  if (/^https?:\/\//i.test(trimmed)) {
    const fromUrl = serverRelativePathFromUrl(trimmed, siteUrl)
    if (fromUrl === null) {
      throw new Error(
        'That is a SharePoint sharing link, which cannot be resolved with read-only access. Open the folder in SharePoint and paste the URL from the browser address bar instead, or enter the folder path relative to the document library.'
      )
    }
    segments = fromUrl
  } else {
    segments = toPathSegments(trimmed)
  }

  if (segments.length === 0) {
    return { driveId: defaultDrive.id, driveName: defaultDriveName }
  }

  const exact = await getItemByPath(accessToken, defaultDrive.id, segments, retryOptions)
  if (exact) {
    if (!exact.folder) throw new Error(`Path "${trimmed}" is not a folder`)
    return { driveId: defaultDrive.id, driveName: defaultDriveName, folderId: exact.id }
  }

  logger.info('SharePoint folder path did not resolve by exact path; trying fallbacks', {
    siteUrl,
    folderPath: trimmed,
    defaultLibrary: defaultDriveName,
  })

  const drives = await listSiteDrives(accessToken, siteId, retryOptions)
  const libraryMatch = drives.find((drive) => matchesDriveName(drive, segments[0]))

  if (libraryMatch) {
    const remainder = segments.slice(1)
    const driveName = libraryMatch.name || segments[0]

    if (remainder.length === 0) {
      return { driveId: libraryMatch.id, driveName }
    }

    const inLibrary = await getItemByPath(accessToken, libraryMatch.id, remainder, retryOptions)
    if (inLibrary) {
      if (!inLibrary.folder) throw new Error(`Path "${trimmed}" is not a folder`)
      return { driveId: libraryMatch.id, driveName, folderId: inLibrary.id }
    }

    const walkedInLibrary = await walkPathByChildren(
      accessToken,
      libraryMatch.id,
      remainder,
      retryOptions
    )
    if (walkedInLibrary) {
      return { driveId: libraryMatch.id, driveName, folderId: walkedInLibrary.id }
    }
  }

  const walked = await walkPathByChildren(accessToken, defaultDrive.id, segments, retryOptions)
  if (walked) {
    return { driveId: defaultDrive.id, driveName: defaultDriveName, folderId: walked.id }
  }

  /**
   * When the first segment named a real library, that library is the one the
   * user meant — report against it and its remainder, not against the default
   * library and the full path, which would blame the wrong library and advise
   * stripping a prefix that was correct.
   */
  const reportDrive = libraryMatch
    ? { id: libraryMatch.id, name: libraryMatch.name || segments[0] }
    : { id: defaultDrive.id, name: defaultDriveName }

  throw new Error(
    await buildFolderNotFoundMessage(
      accessToken,
      reportDrive,
      siteName || siteUrl,
      trimmed,
      libraryMatch ? segments.slice(1) : segments,
      drives,
      reportDrive.id === defaultDrive.id,
      retryOptions
    )
  )
}

/** Lists the site's document libraries. */
async function listSiteDrives(
  accessToken: string,
  siteId: string,
  retryOptions?: RetryOptions
): Promise<Drive[]> {
  const drives: Drive[] = []
  let url = `${GRAPH_BASE}/sites/${siteId}/drives?$select=id,name,webUrl`

  for (let page = 0; page < MAX_DRIVE_PAGES; page++) {
    const response = await graphGet(url, accessToken, retryOptions)
    if (!response.ok) break
    const data = (await response.json()) as DriveListResponse
    drives.push(...(data.value ?? []))
    const nextLink = data['@odata.nextLink']
    if (!nextLink) break
    url = nextLink
  }

  return drives
}

/**
 * Matches a path segment against a document library by display name or by the
 * trailing segment of its URL, which is where "Shared Documents" lives for a
 * library displayed as "Documents".
 */
function matchesDriveName(drive: Drive, segment: string): boolean {
  const target = normalizeSegment(segment)
  if (drive.name && normalizeSegment(drive.name) === target) return true
  if (!drive.webUrl) return false
  const urlLeaf = drive.webUrl.split('/').filter(Boolean).pop()
  return Boolean(urlLeaf && normalizeSegment(decodeURIComponent(urlLeaf)) === target)
}

/**
 * Builds a diagnostic failure message naming the site, the library searched,
 * the path attempted, and the folders that actually exist at that level.
 *
 * `searchedDefaultLibrary` gates the advice about stripping a leading library
 * name: that hint only applies when the path was interpreted against the site's
 * default library, and would be actively misleading when the caller supplied a
 * library name that matched.
 */
async function buildFolderNotFoundMessage(
  accessToken: string,
  drive: { id: string; name: string },
  siteName: string,
  rawFolderPath: string,
  segments: string[],
  drives: Drive[],
  searchedDefaultLibrary: boolean,
  retryOptions?: RetryOptions
): Promise<string> {
  const parts = [
    `Folder not found: "${rawFolderPath}".`,
    `Searched site "${siteName}", document library "${drive.name}", for the library-relative path "${segments.join('/')}".`,
  ]

  try {
    const topLevel = await listChildFolders(accessToken, drive.id, undefined, retryOptions)
    if (topLevel.length > 0) {
      const names = topLevel
        .slice(0, MAX_SUGGESTED_NAMES)
        .map((item) => `"${item.name}"`)
        .join(', ')
      const suffix = topLevel.length > MAX_SUGGESTED_NAMES ? ', …' : ''
      parts.push(`Folders in "${drive.name}": ${names}${suffix}.`)
    } else {
      parts.push(`"${drive.name}" has no top-level folders.`)
    }
  } catch {
    parts.push(`Could not list the contents of "${drive.name}".`)
  }

  if (drives.length > 1) {
    const libraryNames = drives
      .map((item) => item.name)
      .filter(Boolean)
      .map((name) => `"${name}"`)
      .join(', ')
    if (libraryNames) {
      parts.push(`Document libraries on this site: ${libraryNames}.`)
    }
  }

  if (searchedDefaultLibrary) {
    parts.push(
      'The folder path is relative to the document library root, so a leading "Documents" or "Shared Documents" should be omitted unless a folder by that name really exists.'
    )
  }

  return parts.join(' ')
}

/**
 * Pagination state encoded as the cursor string.
 * We track a stack of folder IDs to traverse plus an optional @odata.nextLink.
 */
type PaginationState = MicrosoftGraphTraversalState

function encodeCursor(state: PaginationState): string {
  return encodeMicrosoftGraphTraversalCursor(state, 'SharePoint')
}

function decodeCursor(cursor: string): PaginationState {
  return decodeMicrosoftGraphTraversalCursor(cursor, 'SharePoint')
}

export function appendPendingSharePointFolders(
  pendingFolders: string[],
  discoveredFolders: string[]
): void {
  appendPendingMicrosoftGraphFolders(pendingFolders, discoveredFolders, 'SharePoint')
}

export const sharepointConnector: ConnectorConfig = {
  ...sharepointConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const siteUrl = sourceConfig.siteUrl as string

    // Resolve and cache siteId in syncContext
    let siteId: string
    let siteName: string
    if (syncContext?.siteId) {
      siteId = syncContext.siteId as string
      siteName = (syncContext.siteName as string) ?? ''
    } else {
      const site = await resolveSiteId(accessToken, siteUrl)
      siteId = site.id
      siteName = site.displayName || siteUrl

      if (syncContext) {
        syncContext.siteId = siteId
        syncContext.siteName = siteName
      }
    }

    // Resolve the target library and starting folder (cache in syncContext)
    let driveId: string
    let rootFolderId: string | undefined
    if (syncContext?.driveId) {
      driveId = syncContext.driveId as string
      rootFolderId = syncContext.rootFolderId as string | undefined
    } else {
      const target = await resolveFolderTarget(
        accessToken,
        siteId,
        siteUrl,
        siteName,
        sourceConfig.folderPath as string | undefined
      )
      driveId = target.driveId
      rootFolderId = target.folderId
      if (syncContext) {
        syncContext.driveId = target.driveId
        syncContext.driveName = target.driveName
        syncContext.rootFolderId = target.folderId
      }
    }

    // Decode or initialise pagination state
    let state: PaginationState
    if (cursor) {
      state = decodeCursor(cursor)
    } else {
      state = {
        folderStack: [],
        currentFolder: rootFolderId,
      }
    }

    const documents: ExternalDocument[] = []
    const maxFiles = parseMaxFiles(sourceConfig.maxFiles)
    let totalFetched = (syncContext?.totalDocsFetched as number) ?? 0

    /** Set when the walk stopped for good — either the cap hit or the source ran out. */
    let stopPaging = false
    /** Set when the cap truncated a listing that still had items left to list. */
    let cappedWithItemsLeft = false

    for (let request = 0; request < MAX_LIST_REQUESTS_PER_CALL; request++) {
      const data = await listFolderItems(accessToken, driveId, state.currentFolder, state.nextLink)

      // Separate files and subfolders
      const subfolders: string[] = []
      const files: DriveItem[] = []

      /**
       * Extensions this connector cannot index, tallied per page. A folder of
       * unsupported files otherwise syncs as "success, 0 documents", which reads
       * exactly like a wrong folder path — the failure mode this log exists for.
       * Unsupported files are counted rather than turned into `failed` document
       * rows, so a library of images does not fill the knowledge base with noise.
       */
      const skippedExtensions = new Map<string, number>()

      for (const item of data.value) {
        if (item.folder) {
          subfolders.push(item.id)
        } else if (item.file) {
          if (isIndexableConnectorFile(item.name)) {
            // Keep oversized files; they are surfaced as skipped (failed) docs below.
            files.push(item)
          } else {
            const extension = connectorFileExtension(item.name) ?? '(none)'
            skippedExtensions.set(extension, (skippedExtensions.get(extension) ?? 0) + 1)
          }
        }
      }

      if (skippedExtensions.size > 0) {
        let skippedCount = 0
        for (const count of skippedExtensions.values()) skippedCount += count
        logger.info('Skipped SharePoint files with unsupported extensions', {
          folderId: state.currentFolder ?? 'root',
          skippedCount,
          extensions: Array.from(skippedExtensions.keys()).slice(0, MAX_LOGGED_SKIPPED_EXTENSIONS),
        })
      }

      // Convert files to lightweight stubs (no content download). Oversized files are
      // kept as skipped stubs but do not consume the max-files cap.
      const stubs = files.map((file) =>
        stubOrSkipBySize(itemToStub(file, siteName), file.size, MAX_DOWNLOAD_SIZE)
      )
      const take = takeIndexableWithinCap(stubs, isSkippedDocument, maxFiles, totalFetched)
      documents.push(...take.documents)
      totalFetched += take.indexableCount

      const nextLink = data['@odata.nextLink']

      if (take.capReached) {
        stopPaging = true
        /**
         * Only a cap that actually hid items makes the listing partial. When the
         * cap coincides with the last item of the last folder the source *is*
         * fully listed, and flagging it capped would block deletion
         * reconciliation for a complete listing. Items can be left behind in
         * this very page (the cap cut it short), in later pages of this folder,
         * or in folders still on the stack.
         */
        cappedWithItemsLeft =
          take.documents.length < stubs.length ||
          Boolean(nextLink) ||
          subfolders.length > 0 ||
          state.folderStack.length > 0
        break
      }

      /** A max-files stop must not validate folders beyond the requested scope. */
      appendPendingSharePointFolders(state.folderStack, subfolders)

      if (nextLink) {
        // More pages in the current folder
        state.nextLink = nextLink
        continue
      }

      // Current folder exhausted — move to next folder on the stack
      if (state.folderStack.length > 0) {
        state.currentFolder = state.folderStack.pop()!
        state.nextLink = undefined
        continue
      }

      stopPaging = true
      break
    }

    if (syncContext) {
      syncContext.totalDocsFetched = totalFetched
      if (cappedWithItemsLeft) syncContext.listingCapped = true
    }

    if (stopPaging) {
      return { documents, hasMore: false }
    }

    return {
      documents,
      nextCursor: encodeCursor(state),
      hasMore: true,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const siteUrl = sourceConfig.siteUrl as string

    let siteId = syncContext?.siteId as string | undefined
    let siteName = syncContext?.siteName as string | undefined
    if (!siteId) {
      const site = await resolveSiteId(accessToken, siteUrl)
      siteId = site.id
      siteName = site.displayName ?? siteUrl
      if (syncContext) {
        syncContext.siteId = siteId
        syncContext.siteName = siteName
      }
    }

    /**
     * `listDocuments` caches the resolved library on the shared syncContext, so
     * this only re-resolves when a document is hydrated outside a listing pass.
     */
    let driveId = syncContext?.driveId as string | undefined
    if (!driveId) {
      const target = await resolveFolderTarget(
        accessToken,
        siteId,
        siteUrl,
        siteName ?? siteUrl,
        sourceConfig.folderPath as string | undefined
      )
      driveId = target.driveId
      if (syncContext) {
        syncContext.driveId = target.driveId
        syncContext.driveName = target.driveName
        syncContext.rootFolderId = target.folderId
      }
    }

    const url = `${GRAPH_BASE}/drives/${driveId}/items/${encodeURIComponent(externalId)}?$select=${ITEM_SELECT}`
    const response = await graphGet(url, accessToken)

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get SharePoint file: ${response.status}`)
    }

    const item = (await response.json()) as DriveItem

    if (!item.file || !isIndexableConnectorFile(item.name)) {
      return {
        ...markSkipped(
          itemToStub(item, siteName ?? siteUrl),
          'File is no longer an indexable document'
        ),
        skippedExistingDisposition: 'replace',
      }
    }

    try {
      const payload = await fetchFilePayload(accessToken, driveId, item.id, item.name)
      if (!hasIndexablePayload(payload)) {
        return {
          ...markSkipped(
            itemToStub(item, siteName ?? siteUrl),
            'Document contains no extractable text'
          ),
          skippedExistingDisposition: 'replace',
        }
      }

      const stub = itemToStub(item, siteName ?? siteUrl)
      return { ...stub, ...payload, contentDeferred: false }
    } catch (error) {
      if (error instanceof ConnectorFileTooLargeError) {
        logger.info('Skipping oversized SharePoint file', { fileId: item.id, name: item.name })
        return markSkipped(
          itemToStub(item, siteName ?? siteUrl),
          sizeLimitSkipReason(error.limitBytes)
        )
      }
      /**
       * A transport or Graph failure that survived `fetchWithRetry`. Returning
       * `null` would drop the file from the run with no `failed` row and no error
       * log; rethrowing lets the sync engine record it per-document.
       */
      logger.warn(`Failed to fetch content for file: ${item.name} (${item.id})`, {
        error: toError(error).message,
      })
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const siteUrl = (sourceConfig.siteUrl as string)?.trim()
    if (!siteUrl) {
      return { valid: false, error: 'Site URL is required' }
    }

    try {
      parseMaxFiles(sourceConfig.maxFiles)
    } catch (error) {
      return { valid: false, error: toError(error).message }
    }

    try {
      const site = await resolveSiteId(accessToken, siteUrl, VALIDATE_RETRY_OPTIONS)

      /**
       * Resolves through the same layered path as a sync, so a configuration
       * accepted here is one the sync can actually open.
       */
      await resolveFolderTarget(
        accessToken,
        site.id,
        siteUrl,
        site.displayName,
        sourceConfig.folderPath as string | undefined,
        VALIDATE_RETRY_OPTIONS
      )

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.path === 'string') {
      result.path = metadata.path
    }

    const lastModified = parseTagDate(metadata.lastModifiedDateTime)
    if (lastModified) result.lastModified = lastModified

    if (typeof metadata.fileSize === 'number') {
      result.fileSize = metadata.fileSize
    }

    if (typeof metadata.createdBy === 'string') {
      result.createdBy = metadata.createdBy
    }

    if (typeof metadata.siteName === 'string') {
      result.siteName = metadata.siteName
    }

    return result
  },
}
