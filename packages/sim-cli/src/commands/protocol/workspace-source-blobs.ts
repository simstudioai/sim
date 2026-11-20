/**
 * The binary files of a workspace source directory (workspace files, knowledge documents): how a
 * get downloads them, how both commands tell a local edit from what the CLI last wrote, and which
 * ones the base records. Each blob is identified by the SHA-256 of its bytes, which is also what
 * `.sim/written.json` records for it.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { generateShortId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import {
  APPLY_ORDER,
  type BlobEntry,
  fingerprintOf,
  type KindCodec,
  parseResourceAddress,
  parseWorkspaceBase,
  resourceAddress,
  type WorkspaceKind,
} from '@sim/workspace-code'
import {
  BLOB_KIND_CODECS,
  isBlobKind,
  isBlobPath,
  KIND_LAYOUTS,
} from '@sim/workspace-code/kinds/registry'
import { isWorkspaceSourcePath, kindOfPath } from '@sim/workspace-code/layout'
import {
  stageBatches,
  WORKSPACE_SOURCE_LIMITS,
  WORKSPACE_SOURCE_STAGE_MAX_BYTES,
} from '@sim/workspace-code/limits'
import type {
  FindMissingWorkspaceSourceBlobsResponse,
  GetWorkspaceSourceResponse,
  StageWorkspaceSourceBlobsResponse,
} from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import type { OperationClient } from '../../runtime/called-operations'
import { SourceDirError } from './local-errors'
import {
  checkedPath,
  FILE_CONCURRENCY,
  type FileStat,
  fileStatOf,
  isMissing,
  type StatDigest,
  sameFileStat,
  type Written,
} from './source-dir'

type WorkspaceSource = GetWorkspaceSourceResponse['data']
type ListedBlob = WorkspaceSource['blobs'][number]

/** The v2 route a workspace file blob's `href` names. */
const FILE_DOWNLOAD = /^\/api\/v2\/files\/([^/?#]+)$/
/** The v2 route a knowledge document blob's `href` names. */
const DOCUMENT_DOWNLOAD = /^\/api\/v2\/knowledge\/([^/?#]+)\/documents\/([^/?#]+)\/content$/

/** How a listed blob is downloaded: the operation its `href` names, with its parameters. */
type BlobDownload = { query: Record<string, string> } & (
  | { operation: 'downloadFile'; params: { fileId: string } }
  | {
      operation: 'downloadKnowledgeDocument'
      params: { knowledgeBaseId: string; documentId: string }
    }
)

/** The download a listed blob's `href` names, or `null` for any other href. */
function downloadOf(href: string): BlobDownload | null {
  const url = new URL(href, 'http://source.invalid')
  const query = Object.fromEntries(url.searchParams)
  const file = FILE_DOWNLOAD.exec(url.pathname)
  if (file) {
    return {
      operation: 'downloadFile',
      params: { fileId: decodeURIComponent(file[1]) },
      query,
    }
  }
  const doc = DOCUMENT_DOWNLOAD.exec(url.pathname)
  if (doc) {
    return {
      operation: 'downloadKnowledgeDocument',
      params: {
        knowledgeBaseId: decodeURIComponent(doc[1]),
        documentId: decodeURIComponent(doc[2]),
      },
      query,
    }
  }
  return null
}

/** SHA-256 and size of `file`, read as a stream so a large file costs constant memory. */
async function hashFile(file: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer)
    size += (chunk as Buffer).length
  }
  return { sha256: hash.digest('hex'), size }
}

/**
 * The SHA-256 and size of the blob at `file` (the directory's `path`), with `current`, its stat
 * taken before any read. The digest `written` records is reused only while every field of the stat
 * recorded with it still holds (see {@link FileStat}); otherwise the file is read, so a same-size
 * rewrite that kept its modification time is still seen as an edit.
 */
export async function statDigest(
  file: string,
  path: string,
  current: FileStat,
  written: Written
): Promise<StatDigest> {
  const taken = fileStatOf(current)
  const recorded = written.stats[path]
  const sha256 = written.digests[path]
  if (sha256 !== undefined && recorded !== undefined && sameFileStat(recorded, taken)) {
    return { ...taken, sha256 }
  }
  return { ...taken, ...(await hashFile(file)) }
}

/**
 * The digest of each of `paths` in the directory (see {@link statDigest}), read under one
 * resolved root; a path with no file is left out.
 */
export async function blobDigests(
  dir: string,
  paths: readonly string[],
  written: Written
): Promise<Map<string, StatDigest>> {
  const digests = new Map<string, StatDigest>()
  let root: string
  try {
    root = await realpath(dir)
  } catch (error) {
    if (isMissing(error)) return digests
    throw error
  }
  const verified = new Set<string>()
  await mapWithConcurrency(paths, FILE_CONCURRENCY, async (path) => {
    try {
      const file = await checkedPath(root, path, verified)
      digests.set(path, await statDigest(file, path, await stat(file), written))
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  })
  return digests
}

/**
 * The blobs among `touched` (path → the SHA-256 about to be written, `null` when it is listed
 * without one or removed) whose bytes on disk (`digests`, from {@link blobDigests}) are neither
 * what the CLI last wrote there (`written`) nor what it is about to write. A blob the CLI wrote
 * that is missing now counts as well, a delete no apply has sent: a removal names only a blob
 * found on disk, so a missing one is about to be written again.
 */
export function editedBlobs(
  touched: ReadonlyMap<string, string | null>,
  digests: ReadonlyMap<string, StatDigest>,
  written: Written['digests']
): string[] {
  return [...touched].flatMap(([path, next]) => {
    const current = digests.get(path)?.sha256
    if (current === undefined) return Object.hasOwn(written, path) ? [path] : []
    if (current === next) return []
    return written[path] !== current ? [path] : []
  })
}

/** Refuses a listed blob the directory could not hold, before anything is downloaded. */
export function assertListedBlobs(blobs: readonly ListedBlob[]): void {
  for (const blob of blobs) {
    if (!isWorkspaceSourcePath(blob.path) || !isBlobPath(blob.path)) {
      throw new SourceDirError(`The workspace source named an unsafe file path: ${blob.path}`)
    }
    if (blob.size > WORKSPACE_SOURCE_LIMITS.maxBlobBytes) {
      throw new SourceDirError(
        `${blob.path} is ${blob.size} bytes, over the ${WORKSPACE_SOURCE_LIMITS.maxBlobBytes}-byte limit a directory holds.`
      )
    }
    if (!blob.href.startsWith('/') || !downloadOf(blob.href)) {
      throw new SourceDirError(`${blob.path} names a download this CLI cannot fetch: ${blob.href}`)
    }
  }
}

/**
 * Downloads one listed blob into `file` through the v2 route its `href` names, refusing bytes
 * past the listed size and, at the end, any size or SHA-256 other than the listing's. Returns the
 * SHA-256 of the bytes, which a blob listed without one records in the base.
 */
async function downloadBlob(
  client: OperationClient<'downloadFile' | 'downloadKnowledgeDocument'>,
  blob: ListedBlob,
  file: string
): Promise<string> {
  const download = downloadOf(blob.href)
  if (!download) {
    throw new SourceDirError(`${blob.path} names a download this CLI cannot fetch: ${blob.href}`)
  }
  const response =
    download.operation === 'downloadFile'
      ? await client.requestRaw('downloadFile', {
          params: download.params,
          query: download.query,
        })
      : await client.requestRaw('downloadKnowledgeDocument', {
          params: download.params,
          query: download.query,
        })
  if (!response.body) throw new SourceDirError(`The download of ${blob.path} had no body.`)
  const hash = createHash('sha256')
  let size = 0
  const mismatch = () =>
    new SourceDirError(
      `The download of ${blob.path} does not match the workspace source (expected ${blob.size} bytes${blob.sha256 ? `, SHA-256 ${blob.sha256}` : ''}); nothing was written.`,
      { code: 'SOURCE_BLOB_MISMATCH' }
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
  const sha256 = hash.digest('hex')
  if (size !== blob.size || (blob.sha256 !== undefined && sha256 !== blob.sha256)) throw mismatch()
  return sha256
}

/**
 * The name a verified download is kept under in a get's downloads folder until it moves into
 * place: a digest of its path and listed SHA-256, else of its path, id, revision and size. The path
 * keeps two paths listed with the same bytes apart, since each moves into place on its own. `null`
 * when the listing names neither a hash nor a revision: nothing tells a kept copy from new bytes.
 */
function keptName(blob: ListedBlob): string | null {
  const identity =
    blob.sha256 !== undefined
      ? [blob.path, blob.sha256]
      : blob.rev !== undefined
        ? [blob.path, blob.id, blob.rev, String(blob.size)]
        : null
  return identity && createHash('sha256').update(identity.join('\0')).digest('hex')
}

/**
 * A blob's bytes in a get's downloads folder, verified against its listing. It carries no stat:
 * the renames that move it into place change its change time, so the first command after the get
 * reads it once and records the stat it then has.
 */
export interface FetchedBlob {
  sha256: string
  size: number
  file: string
  /** Whether a failed get keeps the file for the next one to reuse. */
  kept: boolean
}

/**
 * The listed blob's bytes in `downloads`: the copy a failed get kept there when it still matches
 * the listing (one that does not is discarded), else a fresh download, which is kept under its
 * name once verified. The download streams into `partial`, this get's own folder inside
 * `downloads`, as does a verified blob no later get could reuse, so removing that one folder (on an
 * interrupt too) leaves only the kept copies behind.
 */
export async function fetchBlob(
  client: OperationClient<'downloadFile' | 'downloadKnowledgeDocument'>,
  blob: ListedBlob,
  downloads: string,
  partial: string
): Promise<FetchedBlob> {
  const name = keptName(blob)
  // `downloads` was checked to be a real folder; a kept copy in it must be a plain file too.
  const file =
    name === null
      ? join(partial, `${generateShortId()}.bin`)
      : await checkedPath(downloads, name, new Set())
  if (name !== null) {
    try {
      const kept = await hashFile(file)
      if (kept.size === blob.size && (blob.sha256 === undefined || kept.sha256 === blob.sha256)) {
        return { ...kept, file, kept: true }
      }
      await rm(file, { force: true })
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
  const part = join(partial, `${generateShortId()}.part`)
  let sha256: string
  try {
    sha256 = await downloadBlob(client, blob, part)
  } catch (error) {
    await rm(part, { force: true })
    throw error
  }
  await rename(part, file)
  return { sha256, size: blob.size, file, kept: name !== null }
}

/**
 * The base a get writes once it hashed the blobs the server listed without a hash (it had no
 * budget left to): each such blob's resource records it as `{ id, rev, sha256 }`, and its
 * fingerprint becomes that of the files the directory now holds for it, computed by the kind's
 * codec exactly as an apply computes the directory's side. The next apply then judges the
 * resource as one the server had hashed.
 */
export function recordHashedBlobs(
  source: Pick<WorkspaceSource, 'files' | 'blobs' | 'base'>,
  digests: ReadonlyMap<string, string>
): WorkspaceSource['base'] {
  const resources = { ...source.base.resources }
  for (const kind of APPLY_ORDER) {
    if (!isBlobKind(kind)) continue
    const codec: KindCodec<unknown> = BLOB_KIND_CODECS[kind]
    const blobs = new Map(
      source.blobs
        .filter((blob) => kindOfPath(blob.path) === kind)
        .map((blob) => [blob.path, blob] as const)
    )
    if (![...blobs.keys()].some((path) => digests.has(path))) continue
    const texts = Object.keys(source.files).filter((path) => kindOfPath(path) === kind)
    for (const [key, group] of codec.group([...texts, ...blobs.keys()]).groups) {
      const hashed = group.filter((path) => digests.has(path))
      if (hashed.length === 0) continue
      const entries: BlobEntry[] = group.flatMap((path) => {
        const blob = blobs.get(path)
        const sha256 = blob?.sha256 ?? digests.get(path)
        return blob && sha256 ? [{ path, sha256, size: blob.size }] : []
      })
      const text = Object.fromEntries(
        group
          .filter((path) => Object.hasOwn(source.files, path))
          .map((path) => [path, source.files[path]])
      )
      const { decl } = codec.parse(key, text, entries)
      const address = resourceAddress(kind, key)
      const entry = resources[address]
      if (decl === undefined || !entry) continue
      const recorded = { ...entry.blobs }
      for (const path of hashed) {
        const blob = blobs.get(path)
        const sha256 = digests.get(path)
        if (!blob || !sha256 || blob.rev === undefined) continue
        recorded[codec.baseBlobName?.(key, path) ?? path] = { id: blob.id, rev: blob.rev, sha256 }
      }
      resources[address] = {
        ...entry,
        fingerprint: fingerprintOf(codec.canonical(decl)),
        blobs: recorded,
      }
    }
  }
  return { ...source.base, resources }
}

/**
 * The directory path of every blob the base records for `kinds`, with the SHA-256 it records: a
 * workspace file's entry names its path, a knowledge base's names a document under its `docs/`
 * folder.
 */
export function baseBlobDigests(
  base: unknown,
  kinds: readonly WorkspaceKind[]
): Map<string, string> {
  const digests = new Map<string, string>()
  const resources = base === undefined ? {} : (parseWorkspaceBase(base).base?.resources ?? {})
  for (const [address, resource] of Object.entries(resources)) {
    const target = parseResourceAddress(address)
    if (!target || !kinds.includes(target.kind)) continue
    const layout = KIND_LAYOUTS[target.kind]
    for (const [name, blob] of Object.entries(resource.blobs ?? {})) {
      const path = layout.baseBlobPath?.(target.key, name) ?? name
      if (!isBlobPath(path) || !isWorkspaceSourcePath(path)) continue
      digests.set(path, blob.sha256)
    }
  }
  return digests
}

/**
 * The submitted blobs the server now holds byte for byte (the base an apply returned records the
 * same SHA-256 for their path), as `.sim/written.json` records them: the directory's copy is what
 * the CLI last synced, so a later removal reads as a delete and a server change as no local edit.
 */
export function appliedBlobDigests(
  submission: { kinds: readonly WorkspaceKind[]; blobs: ReadonlyArray<BlobEntry> },
  base: unknown
): Record<string, string> {
  const held = baseBlobDigests(base, submission.kinds)
  return Object.fromEntries(
    submission.blobs
      .filter((blob) => held.get(blob.path) === blob.sha256)
      .map((blob) => [blob.path, blob.sha256])
  )
}

/**
 * The submitted blobs whose bytes the server needs: new since the get, or changed (the base
 * records another SHA-256 for their path). An apply without a dry run stages them; a blob the
 * server needs beyond them is refused by name (`E_BLOB_MISSING`), and the CLI stages it and
 * applies once more.
 */
export function blobsToStage(submission: {
  kinds: readonly WorkspaceKind[]
  blobs: ReadonlyArray<BlobEntry>
  base?: unknown
}): Set<string> {
  const held = baseBlobDigests(submission.base, submission.kinds)
  return new Set(
    submission.blobs.filter((blob) => held.get(blob.path) !== blob.sha256).map((blob) => blob.path)
  )
}

/**
 * Refuses an apply whose base records blobs the directory never held: missing on disk and absent
 * from `.sim/written.json`, so no get downloaded them and no one removed them. Sent as they are,
 * every one of them would read as deleted. A blob the CLI wrote and the user then removed is
 * recorded, so its delete still goes through.
 */
export function assertBlobsFetched(
  dir: string,
  submission: {
    kinds: readonly WorkspaceKind[]
    blobs: ReadonlyArray<{ path: string }>
    base?: unknown
  },
  written: Written['digests']
): void {
  const local = new Set(submission.blobs.map((blob) => blob.path))
  const missing = [...baseBlobDigests(submission.base, submission.kinds).keys()].filter(
    (path) => !local.has(path) && !Object.hasOwn(written, path)
  )
  if (missing.length === 0) return
  const shown = missing.slice(0, 5).join(', ')
  throw new SourceDirError(
    `${dir} never downloaded ${missing.length} binary file(s) its base records (${shown}${missing.length > 5 ? ', …' : ''}), so applying it would delete them. Run \`sim workspaces source get --dir ${dir}\` to download them, then apply again.`,
    { code: 'SOURCE_BLOBS_NOT_FETCHED' }
  )
}

/** The bytes of the blob at `path` in the directory, read inside its resolved root. */
export async function blobBytes(dir: string, path: string): Promise<Buffer> {
  return readFile(await checkedPath(await realpath(dir), path, new Set()))
}

/** The calls staging makes. */
type StagingClient = OperationClient<
  'findMissingWorkspaceSourceBlobs' | 'stageWorkspaceSourceBlobs'
>

/**
 * Stages the bytes of the blobs at `paths` for an apply to `workspaceId`: asks which of their
 * hashes the server does not hold staged for this caller, then uploads only those, in requests of
 * at most `maxBlobBytesPerRequest` (a larger blob alone). A blob staged by an earlier, interrupted run is not sent
 * again. A file whose bytes no longer hash to what the directory read is refused before it is
 * sent. Returns how many blobs and bytes were uploaded.
 */
export async function stageBlobs(
  client: StagingClient,
  workspaceId: string,
  dir: string,
  blobs: readonly BlobEntry[],
  paths: ReadonlySet<string>
): Promise<{ count: number; bytes: number }> {
  const byHash = new Map<string, BlobEntry>()
  for (const blob of blobs) if (paths.has(blob.path)) byHash.set(blob.sha256, blob)
  if (byHash.size === 0) return { count: 0, bytes: 0 }
  const missing = new Set<string>()
  const asked = [...byHash.values()].map(({ sha256, size }) => ({ sha256, size }))
  for (let start = 0; start < asked.length; start += WORKSPACE_SOURCE_LIMITS.maxStagedBlobs) {
    const response = await client.request<FindMissingWorkspaceSourceBlobsResponse>(
      'findMissingWorkspaceSourceBlobs',
      {
        params: { workspaceId },
        body: { blobs: asked.slice(start, start + WORKSPACE_SOURCE_LIMITS.maxStagedBlobs) },
        retryRateLimited: true,
      }
    )
    for (const sha256 of response.data.missing) missing.add(sha256)
  }
  const sending = [...missing].flatMap((sha256) => byHash.get(sha256) ?? [])
  let bytes = 0
  for (const batch of stageBatches(sending)) {
    const form = new FormData()
    for (const blob of batch) {
      const content = await blobBytes(dir, blob.path)
      if (
        content.byteLength !== blob.size ||
        createHash('sha256').update(content).digest('hex') !== blob.sha256
      ) {
        throw new SourceDirError(
          `${blob.path} changed while the apply read it; nothing was applied. Apply again.`,
          { code: 'SOURCE_BLOB_CHANGED' }
        )
      }
      form.append(blob.sha256, new Blob([new Uint8Array(content)]), blob.sha256)
      bytes += content.byteLength
    }
    try {
      await client.request<StageWorkspaceSourceBlobsResponse>('stageWorkspaceSourceBlobs', {
        params: { workspaceId },
        form,
        retryRateLimited: true,
      })
    } catch (error) {
      throw stagingTooLarge(error, batch)
    }
  }
  return { count: sending.length, bytes }
}

/**
 * A staging request the server refused as too large (`413`), re-raised naming what it carried and
 * what to do: nothing was applied, and since this CLI batches within the limits it shares with the
 * server, a refusal means the server runs other limits (another version, or a proxy in front of
 * it with a smaller body limit). A staging area with no room (`SOURCE_STAGING_FULL`), which only
 * freeing staged files fixes, and any other error pass through.
 */
function stagingTooLarge(error: unknown, batch: readonly BlobEntry[]): unknown {
  if (!(error instanceof SimApiError) || error.status !== 413) return error
  if (toRecord(error.details).code === 'SOURCE_STAGING_FULL') return error
  const bytes = batch.reduce((sum, blob) => sum + blob.size, 0)
  const largest = batch.reduce((top, blob) => (blob.size > top.size ? blob : top), batch[0])
  return new SimApiError(
    `The server refused an upload of ${batch.length} binary file(s), ${bytes} bytes (largest ${largest.path}), as too large: ${error.message} Nothing was applied. Update the CLI (\`sim update\`) so it splits uploads the way this server accepts; if a proxy in front of the server limits request bodies, raise its limit above ${WORKSPACE_SOURCE_STAGE_MAX_BYTES} bytes.`,
    error.status,
    error.code,
    error.details,
    error.exitCode,
    error.requestId
  )
}
