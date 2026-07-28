import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { sharepointConnectorMeta } from '@/connectors/sharepoint/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  ConnectorFileTooLargeError,
  htmlToPlainText,
  isSkippedDocument,
  markSkipped,
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
  stubOrSkipBySize,
  takeIndexableWithinCap,
} from '@/connectors/utils'

const logger = createLogger('SharePointConnector')

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

const SUPPORTED_TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.html',
  '.htm',
  '.csv',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.log',
  '.rst',
  '.tsv',
])

const MAX_DOWNLOAD_SIZE = CONNECTOR_MAX_FILE_BYTES

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
 * Returns true when the file extension is in the supported text set.
 */
function isSupportedTextFile(name: string): boolean {
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return false
  return SUPPORTED_TEXT_EXTENSIONS.has(name.slice(dotIndex).toLowerCase())
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
    url,
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
  const cleaned = siteUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const firstSlash = cleaned.indexOf('/')
  if (firstSlash === -1) {
    return { hostname: cleaned, serverRelativePath: '' }
  }
  return {
    hostname: cleaned.slice(0, firstSlash),
    serverRelativePath: cleaned.slice(firstSlash),
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
    const errorText = await response.text()
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
 * Downloads the text content of a drive item.
 */
async function downloadFileContent(
  accessToken: string,
  driveId: string,
  itemId: string,
  fileName: string
): Promise<string> {
  const url = `${GRAPH_BASE}/drives/${driveId}/items/${itemId}/content`

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
  return buffer.toString('utf8')
}

/**
 * Fetches file content, applying HTML-to-text conversion for .html files.
 */
async function fetchFileContent(
  accessToken: string,
  driveId: string,
  itemId: string,
  fileName: string
): Promise<string> {
  const raw = await downloadFileContent(accessToken, driveId, itemId, fileName)
  if (fileName.toLowerCase().endsWith('.html') || fileName.toLowerCase().endsWith('.htm')) {
    return htmlToPlainText(raw)
  }
  return raw
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
      ? `${GRAPH_BASE}/drives/${driveId}/items/${folderId}/children?$top=200`
      : `${GRAPH_BASE}/drives/${driveId}/root/children?$top=200`)

  const response = await graphGet(url, accessToken)

  if (!response.ok) {
    const errorText = await response.text()
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

/** Splits a slash-separated path into non-empty, trimmed segments. */
function toPathSegments(path: string): string[] {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
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

  throw new Error(
    await buildFolderNotFoundMessage(
      accessToken,
      { id: defaultDrive.id, name: defaultDriveName },
      siteName || siteUrl,
      trimmed,
      segments,
      drives,
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
  const response = await graphGet(
    `${GRAPH_BASE}/sites/${siteId}/drives?$select=id,name,webUrl`,
    accessToken,
    retryOptions
  )
  if (!response.ok) return []
  const data = (await response.json()) as DriveListResponse
  return data.value ?? []
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
 */
async function buildFolderNotFoundMessage(
  accessToken: string,
  drive: { id: string; name: string },
  siteName: string,
  rawFolderPath: string,
  segments: string[],
  drives: Drive[],
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

  parts.push(
    'The folder path is relative to the document library root, so a leading "Documents" or "Shared Documents" should be omitted unless a folder by that name really exists.'
  )

  return parts.join(' ')
}

/**
 * Pagination state encoded as the cursor string.
 * We track a stack of folder IDs to traverse plus an optional @odata.nextLink.
 */
interface PaginationState {
  /** Folders still to be listed (depth-first) */
  folderStack: string[]
  /** Current folder being listed (undefined = root) */
  currentFolder?: string
  /** @odata.nextLink for the current folder page */
  nextLink?: string
}

function encodeCursor(state: PaginationState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64')
}

function decodeCursor(cursor: string): PaginationState {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as PaginationState
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
    const maxFiles = sourceConfig.maxFiles ? Number(sourceConfig.maxFiles) : 0
    let totalFetched = (syncContext?.totalDocsFetched as number) ?? 0

    // Process one page of items from the current folder
    const data = await listFolderItems(accessToken, driveId, state.currentFolder, state.nextLink)

    // Separate files and subfolders
    const subfolders: string[] = []
    const files: DriveItem[] = []

    for (const item of data.value) {
      if (item.folder) {
        subfolders.push(item.id)
      } else if (item.file && isSupportedTextFile(item.name)) {
        // Keep oversized files; they are surfaced as skipped (failed) docs below.
        files.push(item)
      }
    }

    // Push subfolders onto the stack for depth-first traversal
    state.folderStack.push(...subfolders)

    // Convert files to lightweight stubs (no content download). Oversized files are
    // kept as skipped stubs but do not consume the max-files cap.
    const previouslyFetched = totalFetched
    const stubs = files.map((file) =>
      stubOrSkipBySize(itemToStub(file, siteName), file.size, MAX_DOWNLOAD_SIZE)
    )
    const {
      documents: pageDocuments,
      indexableCount,
      capReached,
    } = takeIndexableWithinCap(stubs, isSkippedDocument, maxFiles, previouslyFetched)
    documents.push(...pageDocuments)

    totalFetched += indexableCount

    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = capReached
    if (hitLimit && syncContext) syncContext.listingCapped = true

    if (hitLimit) {
      return { documents, hasMore: false }
    }

    if (data['@odata.nextLink']) {
      // More pages in the current folder
      state.nextLink = data['@odata.nextLink']
      return {
        documents,
        nextCursor: encodeCursor(state),
        hasMore: true,
      }
    }

    // Current folder exhausted — move to next folder on the stack
    if (state.folderStack.length > 0) {
      const nextFolder = state.folderStack.pop()!
      state.currentFolder = nextFolder
      state.nextLink = undefined
      return {
        documents,
        nextCursor: encodeCursor(state),
        hasMore: true,
      }
    }

    // Nothing left
    return { documents, hasMore: false }
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

    const url = `${GRAPH_BASE}/drives/${driveId}/items/${externalId}`
    const response = await graphGet(url, accessToken)

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get SharePoint file: ${response.status}`)
    }

    const item = (await response.json()) as DriveItem

    if (!item.file || !isSupportedTextFile(item.name)) {
      return null
    }

    try {
      const content = await fetchFileContent(accessToken, driveId, item.id, item.name)
      if (!content.trim()) return null

      const stub = itemToStub(item, siteName ?? siteUrl)
      return { ...stub, content, contentDeferred: false }
    } catch (error) {
      if (error instanceof ConnectorFileTooLargeError) {
        logger.info('Skipping oversized SharePoint file', { fileId: item.id, name: item.name })
        return markSkipped(
          itemToStub(item, siteName ?? siteUrl),
          sizeLimitSkipReason(error.limitBytes)
        )
      }
      logger.warn(`Failed to fetch content for file: ${item.name} (${item.id})`, {
        error: toError(error).message,
      })
      return null
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

    const maxFiles = sourceConfig.maxFiles as string | undefined
    if (maxFiles && (Number.isNaN(Number(maxFiles)) || Number(maxFiles) <= 0)) {
      return { valid: false, error: 'Max files must be a positive number' }
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
