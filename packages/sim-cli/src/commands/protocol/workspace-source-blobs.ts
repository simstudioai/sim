/**
 * The binary files of a workspace source directory (workspace files, knowledge documents): how a
 * get downloads them, how both commands tell a local edit from what the CLI last wrote, and which
 * ones the base records. Each blob is identified by the SHA-256 of its bytes, which is also what
 * `.sim/written.json` records for it.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import type { GetWorkspaceSourceResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import type { OperationClient } from '../../runtime/called-operations'
import { checkedPath, inPool, isMissing, readWrittenDigests } from './source-dir'

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
export async function hashFile(file: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer)
    size += (chunk as Buffer).length
  }
  return { sha256: hash.digest('hex'), size }
}

/**
 * SHA-256 of each of `paths` in the directory, read under one resolved root; a path with no file
 * is left out.
 */
export async function blobDigests(
  dir: string,
  paths: readonly string[]
): Promise<Map<string, string>> {
  const digests = new Map<string, string>()
  let root: string
  try {
    root = await realpath(dir)
  } catch (error) {
    if (isMissing(error)) return digests
    throw error
  }
  const verified = new Set<string>()
  await inPool([...paths], async (path) => {
    try {
      digests.set(path, (await hashFile(await checkedPath(root, path, verified))).sha256)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  })
  return digests
}

/**
 * The blobs among `touched` (path → the SHA-256 about to be written, or `null` for a removal)
 * whose bytes on disk (`digests`, from {@link blobDigests}) are neither what the CLI last wrote
 * there nor what it is about to write.
 */
export async function editedBlobs(
  dir: string,
  touched: ReadonlyMap<string, string | null>,
  digests: ReadonlyMap<string, string>
): Promise<string[]> {
  const written = await readWrittenDigests(dir)
  return [...touched].flatMap(([path, next]) => {
    const current = digests.get(path)
    if (current === undefined || current === next) return []
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
    if (!blob.href.startsWith('/') || !downloadOf(blob.href)) {
      throw new SimApiError(`${blob.path} names a download this CLI cannot fetch: ${blob.href}`, 0)
    }
  }
}

/**
 * Downloads one listed blob into `file` through the v2 route its `href` names, refusing bytes
 * past the listed size and, at the end, any size or SHA-256 other than the listing's. Returns the
 * SHA-256 of the bytes, which a blob listed without one records in the base.
 */
export async function downloadBlob(
  client: OperationClient<'downloadFile' | 'downloadKnowledgeDocument'>,
  blob: ListedBlob,
  file: string
): Promise<string> {
  const download = downloadOf(blob.href)
  if (!download) {
    throw new SimApiError(`${blob.path} names a download this CLI cannot fetch: ${blob.href}`, 0)
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
  if (!response.body) throw new SimApiError(`The download of ${blob.path} had no body.`, 0)
  const hash = createHash('sha256')
  let size = 0
  const mismatch = () =>
    new SimApiError(
      `The download of ${blob.path} does not match the workspace source (expected ${blob.size} bytes${blob.sha256 ? `, SHA-256 ${blob.sha256}` : ''}); nothing was written.`,
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
  const sha256 = hash.digest('hex')
  if (size !== blob.size || (blob.sha256 !== undefined && sha256 !== blob.sha256)) throw mismatch()
  return sha256
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
function baseBlobDigests(base: unknown, kinds: readonly WorkspaceKind[]): Map<string, string> {
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
  const missing = [...baseBlobDigests(submission.base, submission.kinds).keys()].filter(
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
