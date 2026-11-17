/**
 * The binary files of a workspace source directory (workspace files, knowledge documents): how a
 * get downloads them, how both commands tell a local edit from what the CLI last wrote, and which
 * ones the base records. Each blob is identified by the SHA-256 of its bytes, which is also what
 * `.sim/written.json` records for it.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { KIND_DIRS, type WorkspaceKind } from '@sim/workspace-code'
import { isBlobPath, isWorkspaceSourcePath } from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import type { GetWorkspaceSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import type { OperationClient } from '../../runtime/called-operations'
import { inBatches, readWrittenDigests } from './workflow-source-layout'

type ListedBlob = GetWorkspaceSourceResponse['data']['blobs'][number]

/** The v2 file download route a blob's `href` must name. */
const FILE_DOWNLOAD = /^\/api\/v2\/files\/([^/?#]+)$/

/** SHA-256 of the file at `path` in the directory, or `null` when there is none. */
export async function blobDigest(dir: string, path: string): Promise<string | null> {
  try {
    const bytes = await readFile(join(await realpath(dir), path))
    return createHash('sha256').update(bytes).digest('hex')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * The blobs among `touched` (path → the SHA-256 about to be written, or `null` for a removal)
 * whose bytes on disk are neither what the CLI last wrote there nor what it is about to write.
 */
export async function editedBlobs(
  dir: string,
  touched: ReadonlyMap<string, string | null>
): Promise<string[]> {
  const written = await readWrittenDigests(dir)
  const entries = [...touched]
  const digests = await inBatches(entries, ([path]) => blobDigest(dir, path))
  return entries.flatMap(([path, next], index) => {
    const current = digests[index]
    if (current === null || current === next) return []
    return written[path] !== current ? [path] : []
  })
}

/** Refuses a listed blob the directory could not hold, before anything is downloaded. */
export function assertListedBlobs(blobs: readonly ListedBlob[]): void {
  for (const blob of blobs) {
    if (!isWorkspaceSourcePath(blob.path) || !isBlobPath(blob.path)) {
      throw new SimApiError(`The workspace source named an unsafe file path: ${blob.path}`, 0)
    }
    if (blob.size > WORKSPACE_SOURCE_LIMITS.maxBlobBytes) {
      throw new SimApiError(
        `${blob.path} is ${blob.size} bytes, over the ${WORKSPACE_SOURCE_LIMITS.maxBlobBytes}-byte limit a directory holds.`,
        0
      )
    }
    if (!FILE_DOWNLOAD.test(new URL(blob.href, 'http://source.invalid').pathname)) {
      throw new SimApiError(`${blob.path} names a download this CLI cannot fetch: ${blob.href}`, 0)
    }
  }
}

/**
 * Downloads one listed blob into `file` through the v2 file route its `href` names, refusing
 * bytes past the listed size and, at the end, any size or SHA-256 other than the listing's.
 */
export async function downloadBlob(
  client: OperationClient<'downloadFile'>,
  blob: ListedBlob,
  file: string
): Promise<void> {
  if (!blob.href.startsWith('/')) {
    throw new SimApiError(`${blob.path} names a download on another origin: ${blob.href}`, 0)
  }
  const url = new URL(blob.href, 'http://source.invalid')
  const fileId = FILE_DOWNLOAD.exec(url.pathname)?.[1]
  if (!fileId) {
    throw new SimApiError(`${blob.path} names a download this CLI cannot fetch: ${blob.href}`, 0)
  }
  const response = await client.requestRaw('downloadFile', {
    params: { fileId: decodeURIComponent(fileId) },
    query: Object.fromEntries(url.searchParams),
  })
  if (!response.body) throw new SimApiError(`The download of ${blob.path} had no body.`, 0)
  const hash = createHash('sha256')
  let size = 0
  const mismatch = () =>
    new SimApiError(
      `The download of ${blob.path} does not match the workspace source (expected ${blob.size} bytes, SHA-256 ${blob.sha256}); nothing was written.`,
      0,
      'SOURCE_BLOB_MISMATCH'
    )
  const check = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      if (size > blob.size) {
        done(mismatch())
        return
      }
      hash.update(chunk)
      done(null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    check,
    createWriteStream(file, { flags: 'wx' })
  )
  if (size !== blob.size || hash.digest('hex') !== blob.sha256) throw mismatch()
}

/**
 * The directory path of every blob the base records for `kinds`: a workspace file's entry names
 * its path, a knowledge base's names a document under its `docs/` folder.
 */
function baseBlobPaths(base: unknown, kinds: readonly WorkspaceKind[]): string[] {
  const resources =
    typeof base === 'object' && base !== null && 'resources' in base ? base.resources : null
  if (typeof resources !== 'object' || resources === null) return []
  const paths: string[] = []
  for (const [address, resource] of Object.entries(resources)) {
    const colon = address.indexOf(':')
    const kind = address.slice(0, colon)
    const key = address.slice(colon + 1)
    if (!kinds.some((managed) => managed === kind)) continue
    const blobs =
      typeof resource === 'object' && resource !== null && 'blobs' in resource
        ? resource.blobs
        : null
    if (typeof blobs !== 'object' || blobs === null) continue
    for (const name of Object.keys(blobs)) {
      const path =
        kind === 'knowledge-base' ? `${KIND_DIRS['knowledge-base']}/${key}/docs/${name}` : name
      if (isBlobPath(path) && isWorkspaceSourcePath(path)) paths.push(path)
    }
  }
  return paths
}

/**
 * Refuses an apply whose base records blobs the directory never held: missing on disk and absent
 * from `.sim/written.json`, so no get downloaded them and no one removed them. Sent as they are,
 * every one of them would read as deleted. A blob the CLI wrote and the user then removed is
 * recorded, so its delete still goes through.
 */
export async function assertBlobsFetched(
  dir: string,
  submission: {
    kinds: readonly WorkspaceKind[]
    blobs: ReadonlyArray<{ path: string }>
    base?: unknown
  }
): Promise<void> {
  const local = new Set(submission.blobs.map((blob) => blob.path))
  const written = await readWrittenDigests(dir)
  const missing = baseBlobPaths(submission.base, submission.kinds).filter(
    (path) => !local.has(path) && !Object.hasOwn(written, path)
  )
  if (missing.length === 0) return
  const shown = missing.slice(0, 5).join(', ')
  throw new SimApiError(
    `${dir} never downloaded ${missing.length} binary file(s) its base records (${shown}${missing.length > 5 ? ', …' : ''}), so applying it would delete them. Run \`sim workspaces source get --dir ${dir}\` to download them, then apply again.`,
    0,
    'SOURCE_BLOBS_NOT_FETCHED'
  )
}
