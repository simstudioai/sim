import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { type Attributes, type Client, type SFTPWrapper, utils as ssh2Utils } from 'ssh2'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  createSftpConnection,
  getFileType,
  getSftp,
  isPathSafe,
  readSftpFileCapped,
} from '@/lib/internal/sftp/client'
import { sftpConnectorMeta } from '@/connectors/sftp/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  htmlToPlainText,
  markSkipped,
  parseTagDate,
  sizeLimitSkipReason,
  stubOrSkipBySize,
} from '@/connectors/utils'

const logger = createLogger('SftpConnector')

/** Maximum bytes read from a single remote file. Larger files are surfaced as skipped. */
const MAX_FILE_SIZE = CONNECTOR_MAX_FILE_BYTES

/** Directory levels below the root path walked when `maxDepth` is not configured. */
const DEFAULT_MAX_DEPTH = 5

/** Hard ceiling on directory recursion, regardless of the configured `maxDepth`. */
const MAX_ALLOWED_DEPTH = 10

/** Files listed per sync when `maxFiles` is not configured. */
const DEFAULT_MAX_FILES = 2000

/** Hard ceiling on files listed per sync, regardless of the configured `maxFiles`. */
const MAX_ALLOWED_FILES = 10_000

/** Hard ceiling on `readdir` calls per sync, bounding wide (rather than deep) trees. */
const MAX_DIRECTORIES = 1000

/**
 * Hard ceiling on entries read from a single remote directory.
 *
 * `SFTPWrapper.readdir(path)` opens a handle and loops until the server reports
 * EOF, accumulating every entry into one array, so a directory holding tens of
 * millions of names — from a hostile server or merely a huge one — is an
 * unbounded allocation inside a single call that none of the walk's other caps
 * can interrupt. Reading the handle page by page lets the walk stop at this
 * ceiling instead.
 */
const MAX_ENTRIES_PER_DIRECTORY = 20_000

/**
 * Hard ceiling on entries emitted by a single walk, counting oversized files.
 * Oversized files deliberately do not consume the `maxFiles` budget, so without
 * this second ceiling a tree of nothing but oversized files would grow the
 * listing until the walk ran out of directories.
 */
const MAX_LISTED_ENTRIES = MAX_ALLOWED_FILES

/** Seconds to wait for the SSH handshake before giving up. */
const READY_TIMEOUT_MS = 20_000

/**
 * Keepalive cadence. ssh2 tears the connection down after three unanswered
 * keepalives, which is what turns a server that accepts the TCP connection and
 * then goes silent into an error rather than an indefinite wait.
 */
const KEEPALIVE_INTERVAL_MS = 10_000

/**
 * Wall-clock ceiling on a directory walk. `readyTimeout` bounds only the SSH
 * handshake; every SFTP request after it is unbounded, so a server that answers
 * the handshake and then trickles (or never answers) `readdir` would otherwise
 * hold the sync task open until its own 30-minute deadline.
 */
const LISTING_TIMEOUT_MS = 10 * 60_000

/** Wall-clock ceiling on fetching a single document, for the same reason. */
const DOCUMENT_TIMEOUT_MS = 2 * 60_000

/**
 * Slack subtracted from the incremental cutoff. `mtime` comes from the remote
 * server's clock: if it runs behind ours, a file written just after a sync gets
 * an `mtime` below the cutoff and would be skipped by every later incremental
 * sync, silently and permanently. Re-listing a few minutes of overlap is cheap
 * because unchanged documents are hash-gated by the sync engine.
 */
const INCREMENTAL_CLOCK_SKEW_SECONDS = 300

/** Bytes inspected when sniffing a downloaded file for binary content. */
const BINARY_SNIFF_BYTES = 8192

/**
 * File extensions considered safely text-extractable. Anything else (or a file
 * with no extension) is skipped, since its bytes cannot be reliably decoded to
 * plain text. Users override this list via the `extensions` config field.
 *
 * Markup-bearing formats are included only when this connector can flatten them
 * (see {@link HTML_EXTENSIONS}). `rtf` is deliberately absent: there is no RTF
 * text extractor here, so the indexed content would be the control-word source
 * (`{\rtf1\ansi\deff0...`) rather than the document's prose.
 */
const DEFAULT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'ndjson',
  'html',
  'htm',
  'xml',
  'yaml',
  'yml',
  'log',
])

/** Extensions whose content is rendered markup and must be flattened before indexing. */
const HTML_EXTENSIONS = new Set(['html', 'htm'])

/**
 * Minimal shape of an `SFTPWrapper.readdir` entry. Declared structurally rather
 * than importing ssh2's `FileEntryWithStats` so the connector depends only on
 * the fields it reads.
 */
interface SftpDirEntry {
  filename: string
  attrs: Attributes
}

/** A remote file selected for syncing during the directory walk. */
interface SftpFileEntry {
  /** Absolute remote path, used as the document's externalId. */
  path: string
  /** Absolute remote path of the containing directory. */
  directory: string
  size: number
  /** Modification time in epoch seconds, as reported by the server. */
  mtime: number
}

/** Connection and scope parameters resolved from sourceConfig + the stored secret. */
interface SftpContext {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  /** Pinned SHA-256 host key fingerprint. Required — there is no unverified mode. */
  hostFingerprint: string
  rootPath: string
  allowedExtensions: Set<string>
  maxDepth: number
  maxFiles: number
}

/**
 * Parses the comma-separated `extensions` override into a normalized set
 * (lowercased, no leading dot). Falls back to the built-in text formats.
 */
function resolveExtensions(raw: unknown): Set<string> {
  if (typeof raw !== 'string') return DEFAULT_EXTENSIONS
  const exts = raw
    .split(',')
    .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
  return exts.length > 0 ? new Set(exts) : DEFAULT_EXTENSIONS
}

/**
 * Clamps a numeric config value into `[1, max]`, falling back to `fallback`
 * when the value is absent or not a positive number.
 */
function resolveBoundedNumber(raw: unknown, fallback: number, max: number): number {
  const parsed = typeof raw === 'number' ? raw : Number((raw as string) ?? '')
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

/**
 * Unpadded base64 of a SHA-256 digest — what OpenSSH prints after the `SHA256:`
 * prefix (32 digest bytes encode to 43 base64 characters). Base64 is
 * case-significant, so the body is matched as-is; only the `SHA256:` label is
 * treated case-insensitively.
 */
const SHA256_FINGERPRINT_PATTERN = /^[A-Za-z0-9+/]{43}$/

/** How to obtain the fingerprint, appended to every fingerprint failure. */
const FINGERPRINT_HOWTO =
  'Get it by running "ssh-keyscan -t rsa,ecdsa,ed25519 <host> | ssh-keygen -lf -" from a trusted network ' +
  'and pasting the SHA256:... value into the Host Key Fingerprint field.'

/** Message for a source saved without a fingerprint, or with it edited back out. */
const FINGERPRINT_REQUIRED_MESSAGE =
  'Host Key Fingerprint is required for SFTP sources. Without it, SSH accepts whatever host key ' +
  "answers, so an on-path attacker impersonating the server would be handed this source's " +
  `password or private key. ${FINGERPRINT_HOWTO}`

/**
 * Normalizes and validates the pinned host key fingerprint.
 *
 * Host verification is mandatory: an absent, blank, or unusable value fails
 * closed here rather than falling through to ssh2's default of accepting any
 * host key. Tolerant of the shapes the value is pasted in — with or without the
 * `SHA256:` label, with or without base64 `=` padding, and with wrapped or
 * surrounding whitespace — because a rejected paste that looks correct pushes
 * users toward removing the pin.
 */
function resolveHostFingerprint(raw: unknown): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed) throw new Error(FINGERPRINT_REQUIRED_MESSAGE)

  const normalized = trimmed
    .replace(/^sha256:/i, '')
    .replace(/\s+/g, '')
    .replace(/=+$/, '')
  if (!SHA256_FINGERPRINT_PATTERN.test(normalized)) {
    throw new Error(
      `"${trimmed}" is not a SHA-256 host key fingerprint. Expected "SHA256:" followed by 43 base64 ` +
        `characters (an MD5 "aa:bb:cc:..." fingerprint will not work). ${FINGERPRINT_HOWTO}`
    )
  }
  return normalized
}

/** Extracts the lowercased extension of a path segment, or '' when there is none. */
function getExtension(filePath: string): string {
  const name = filePath.split('/').pop() ?? ''
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === name.length - 1) return ''
  return name.slice(dotIndex + 1).toLowerCase()
}

/**
 * Normalizes a remote path to an absolute, separator-collapsed form without a
 * trailing slash (the root `/` is preserved).
 *
 * Deliberately does NOT percent-decode. SFTP paths are opaque byte strings, not
 * URLs, so decoding corrupts every legitimate remote name containing a `%`
 * followed by two hex digits: a file listed as `report%20final.txt` would be
 * requested as `report final.txt` and could never be hydrated. Traversal is
 * rejected up front by {@link isPathSafe}, which does check the decoded form,
 * and the result is prefix-checked against the configured root, so declining to
 * decode here is also the stricter choice — a literal `%2e%2e%2f` stays literal
 * on the wire instead of being turned into `../`.
 */
function normalizeRemotePath(raw: string): string {
  const sanitized = raw.replace(/\0/g, '').replace(/\\/g, '/').replace(/\/+/g, '/').trim()
  const absolute = sanitized.startsWith('/') ? sanitized : `/${sanitized}`
  const trimmed = absolute.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/** Joins a directory and a child name into an absolute remote path. */
function joinRemotePath(directory: string, name: string): string {
  return directory === '/' ? `/${name}` : `${directory}/${name}`
}

/** True when `candidate` is the root path itself or lives beneath it. */
function isWithinRoot(candidate: string, rootPath: string): boolean {
  if (rootPath === '/') return true
  return candidate === rootPath || candidate.startsWith(`${rootPath}/`)
}

/**
 * Resolves connection parameters from the connector's sourceConfig and the
 * decrypted secret (delivered as `accessToken`). The secret is interpreted as a
 * password or an OpenSSH private key depending on `authMethod`.
 *
 * Every entry point — `listDocuments`, `getDocument`, and `validateConfig` —
 * resolves through here, which is what makes the host key fingerprint enforced
 * at sync time and not merely at validation time. A source persisted before the
 * fingerprint became required, or edited out of band afterwards, fails its next
 * sync instead of silently connecting unverified.
 */
function resolveContext(accessToken: string, sourceConfig: Record<string, unknown>): SftpContext {
  const host = ((sourceConfig.host as string) ?? '').trim()
  const username = ((sourceConfig.username as string) ?? '').trim()
  const rawRootPath = ((sourceConfig.rootPath as string) ?? '').trim()
  const secret = (accessToken ?? '').trim()
  const authMethod = ((sourceConfig.authMethod as string) ?? 'password').trim()

  if (!host) throw new Error('Missing SFTP host')
  if (!username) throw new Error('Missing SFTP username')
  if (!rawRootPath) throw new Error('Missing root path')
  if (!secret) throw new Error('Missing SFTP password or private key')
  if (!isPathSafe(rawRootPath)) {
    throw new Error('Root path must not contain path traversal sequences')
  }

  const port = resolveBoundedNumber(sourceConfig.port, 22, 65535)
  const hostFingerprint = resolveHostFingerprint(sourceConfig.hostFingerprint)

  return {
    host,
    port,
    username,
    hostFingerprint,
    password: authMethod === 'privateKey' ? undefined : secret,
    privateKey: authMethod === 'privateKey' ? secret : undefined,
    rootPath: normalizeRemotePath(rawRootPath),
    allowedExtensions: resolveExtensions(sourceConfig.extensions),
    maxDepth: resolveBoundedNumber(sourceConfig.maxDepth, DEFAULT_MAX_DEPTH, MAX_ALLOWED_DEPTH),
    maxFiles: resolveBoundedNumber(sourceConfig.maxFiles, DEFAULT_MAX_FILES, MAX_ALLOWED_FILES),
  }
}

/**
 * Opens an SSH/SFTP session, runs `fn` under a wall-clock deadline, and always
 * tears the connection down — including on the error and timeout paths — so a
 * failed sync never leaks a socket.
 *
 * Host validation (DNS resolution plus private/loopback/reserved-IP rejection,
 * with the connection pinned to the resolved address) happens inside
 * {@link createSftpConnection}, which is the SSH counterpart to the HTTP
 * `secureFetchWithRetry` boundary used by the other file-storage connectors.
 * That same helper also pins the server's host key to the source's required
 * fingerprint, so a mismatched key aborts the handshake before any credential
 * is sent. IP pinning alone would close DNS rebinding but not an on-path
 * attacker, which is why the fingerprint has no opt-out.
 */
async function withSftpSession<T>(
  ctx: SftpContext,
  timeoutMs: number,
  fn: (sftp: SFTPWrapper) => Promise<T>
): Promise<T> {
  let client: Client | undefined
  let timer: NodeJS.Timeout | undefined
  try {
    const connection = await createSftpConnection({
      host: ctx.host,
      port: ctx.port,
      username: ctx.username,
      password: ctx.password,
      privateKey: ctx.privateKey,
      hostFingerprint: ctx.hostFingerprint,
      readyTimeout: READY_TIMEOUT_MS,
      keepaliveInterval: KEEPALIVE_INTERVAL_MS,
    })
    client = connection
    const sftp = await getSftp(connection)
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        /**
         * `destroy`, not `end`: a graceful close half-closes the socket and then
         * waits for a FIN the unresponsive server that caused this timeout is
         * unlikely to send, leaving the descriptor open.
         */
        connection.destroy()
        reject(new Error(`SFTP session exceeded ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
    })
    /**
     * `race` keeps a rejection handler attached to `fn`, so the requests the
     * timeout cancels settle without surfacing as unhandled rejections.
     */
    return await Promise.race([fn(sftp), deadline])
  } finally {
    if (timer) clearTimeout(timer)
    client?.end()
  }
}

/** SFTP status the server sends once a directory handle has been read to the end. */
const SFTP_STATUS_EOF = ssh2Utils.sftp.STATUS_CODE.EOF

/** One bounded read of a remote directory. */
interface DirectoryListing {
  entries: SftpDirEntry[]
  /** True when the per-directory ceiling stopped the read before EOF. */
  truncated: boolean
}

/** Promise wrapper around `SFTPWrapper.opendir`. */
function openRemoteDirectory(sftp: SFTPWrapper, directory: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.opendir(directory, (err, handle) => {
      if (err) reject(err)
      else resolve(handle)
    })
  })
}

/**
 * Reads the next page from an open directory handle, resolving null at EOF.
 * ssh2 surfaces EOF as an error carrying `STATUS_CODE.EOF` rather than as an
 * empty list, so it is translated here instead of propagating as a failure.
 */
function readDirectoryPage(sftp: SFTPWrapper, handle: Buffer): Promise<SftpDirEntry[] | null> {
  return new Promise((resolve, reject) => {
    sftp.readdir(handle, (err, list) => {
      if (err) {
        if ((err as Error & { code?: number }).code === SFTP_STATUS_EOF) resolve(null)
        else reject(err)
      } else {
        resolve(list)
      }
    })
  })
}

/**
 * Lists a remote directory a page at a time, stopping at
 * {@link MAX_ENTRIES_PER_DIRECTORY}. The handle is always closed, including on
 * the error and ceiling paths, so a walk over many directories cannot exhaust
 * the server's open-handle budget.
 */
async function readRemoteDirectory(
  sftp: SFTPWrapper,
  directory: string
): Promise<DirectoryListing> {
  const handle = await openRemoteDirectory(sftp, directory)
  const entries: SftpDirEntry[] = []
  let truncated = false

  try {
    while (!truncated) {
      const page = await readDirectoryPage(sftp, handle)
      if (page === null) break

      for (const entry of page) {
        if (entries.length >= MAX_ENTRIES_PER_DIRECTORY) {
          truncated = true
          break
        }
        entries.push(entry)
      }
    }
  } finally {
    sftp.close(handle, () => {})
  }

  return { entries, truncated }
}

/**
 * True for the SFTP status the server returns when a path no longer exists.
 *
 * Prefers the numeric status ssh2 attaches to SFTP failures; the message match
 * is the fallback for the paths that surface a re-wrapped `Error` without one.
 */
function isNotFoundError(error: unknown): boolean {
  const code = (error as { code?: number } | null)?.code
  if (code === ssh2Utils.sftp.STATUS_CODE.NO_SUCH_FILE) return true
  return /no such file|not found|ENOENT/i.test(getErrorMessage(error, ''))
}

/**
 * Promise wrapper around `SFTPWrapper.stat`/`lstat`, resolving null when the
 * path is gone.
 *
 * `follow: false` issues `SSH_FXP_LSTAT`, which describes the link itself
 * instead of its target. Document reads use it so a symlink planted (or swapped
 * in) under the root cannot be resolved into a file outside it; the root-path
 * check in `validateConfig` follows links deliberately, since a symlinked root
 * directory is a legitimate configuration.
 */
function statRemotePath(
  sftp: SFTPWrapper,
  remotePath: string,
  { follow }: { follow: boolean }
): Promise<Attributes | null> {
  return new Promise((resolve, reject) => {
    const stat = follow ? sftp.stat.bind(sftp) : sftp.lstat.bind(sftp)
    stat(remotePath, (err, stats) => {
      if (err) {
        if (isNotFoundError(err)) resolve(null)
        else reject(err)
      } else {
        resolve(stats)
      }
    })
  })
}

/** Outcome of a bounded directory walk. */
interface WalkResult {
  files: SftpFileEntry[]
  /**
   * True when the walk stopped short of the full tree — a cap was hit or a
   * directory could not be read — meaning still-present files are missing from
   * the listing and deletion reconciliation must be suppressed.
   */
  truncated: boolean
}

/**
 * Walks the remote tree breadth-first from the root path, collecting files whose
 * extension is indexable. Bounded on three axes — recursion depth, number of
 * `readdir` calls, and number of indexable files — so a hostile or merely huge
 * remote tree can never drive an unbounded traversal.
 *
 * Symlinks are never followed: they are the mechanism by which a remote tree can
 * escape the configured root or cycle forever. `readdir` reports link entries
 * with `lstat` semantics, so a symlink is classified as `symlink` here and falls
 * through both the directory and the file branch.
 *
 * Oversized files still ride along as skipped stubs (they surface as failed rows
 * in the knowledge base) and do not consume the file budget, so they are bounded
 * separately by {@link MAX_LISTED_ENTRIES}.
 */
async function walkTree(
  sftp: SFTPWrapper,
  ctx: SftpContext,
  lastSyncAt?: Date
): Promise<WalkResult> {
  const cutoffSeconds = lastSyncAt
    ? Math.floor(lastSyncAt.getTime() / 1000) - INCREMENTAL_CLOCK_SKEW_SECONDS
    : undefined
  const files: SftpFileEntry[] = []
  const queue: Array<{ path: string; depth: number }> = [{ path: ctx.rootPath, depth: 0 }]

  let indexableCount = 0
  let directoriesRead = 0
  let truncated = false

  while (queue.length > 0) {
    if (indexableCount >= ctx.maxFiles) {
      truncated = true
      break
    }
    if (directoriesRead >= MAX_DIRECTORIES) {
      truncated = true
      break
    }
    if (files.length >= MAX_LISTED_ENTRIES) {
      truncated = true
      break
    }

    const current = queue.shift()
    if (!current) break

    let entries: SftpDirEntry[]
    try {
      const listing = await readRemoteDirectory(sftp, current.path)
      entries = listing.entries
      /**
       * A directory read that stopped at the per-directory ceiling leaves real
       * files unlisted, exactly like the walk-level caps below.
       */
      if (listing.truncated) truncated = true
      directoriesRead += 1
    } catch (error) {
      /**
       * A directory that cannot be read may still hold live documents, so the
       * listing is incomplete and must not trigger deletion reconciliation.
       */
      logger.warn('Failed to read SFTP directory', {
        directory: current.path,
        error: toError(error).message,
      })
      truncated = true
      continue
    }

    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') continue

      /**
       * Directory entries come from the remote server, which is not trusted to
       * return real POSIX names: a filename carrying separators or NUL bytes
       * would compose a path pointing outside the configured root.
       */
      if (/[/\\\0]/.test(entry.filename)) {
        logger.warn('Skipping SFTP entry with an illegal filename', { directory: current.path })
        continue
      }

      const childPath = joinRemotePath(current.path, entry.filename)
      const type = getFileType(entry.attrs)

      if (type === 'directory') {
        /**
         * `maxDepth` is a configured scope filter, not a cap: files below it are
         * never indexed in the first place, so their absence is not evidence of
         * a partial listing. Flagging it would leave `listingCapped` set on
         * every sync of any tree deeper than the limit, permanently suppressing
         * deletion reconciliation.
         */
        if (current.depth + 1 > ctx.maxDepth) continue
        /**
         * The pending queue is capped as well as the number of reads: a single
         * directory holding millions of subdirectories would otherwise grow the
         * queue without bound long before the read ceiling stopped the walk.
         */
        if (queue.length >= MAX_DIRECTORIES) {
          truncated = true
          continue
        }
        queue.push({ path: childPath, depth: current.depth + 1 })
        continue
      }

      if (type !== 'file') continue
      if (!ctx.allowedExtensions.has(getExtension(entry.filename))) continue

      const size = entry.attrs.size ?? 0
      if (size <= 0) continue

      const mtime = entry.attrs.mtime ?? 0
      if (cutoffSeconds !== undefined && mtime < cutoffSeconds) continue

      if (files.length >= MAX_LISTED_ENTRIES) {
        truncated = true
        break
      }

      const oversized = size > MAX_FILE_SIZE
      if (!oversized) {
        if (indexableCount >= ctx.maxFiles) {
          truncated = true
          break
        }
        indexableCount += 1
      }

      files.push({ path: childPath, directory: current.path, size, mtime })
    }
  }

  return { files, truncated }
}

/**
 * Builds a metadata stub for a remote file. The hash is derived purely from
 * listing metadata (path, mtime, size) so change detection never requires
 * downloading content, and it is produced here for both `listDocuments` and
 * `getDocument` so the two can never disagree.
 */
function fileToStub(ctx: SftpContext, entry: SftpFileEntry): ExternalDocument {
  const title = entry.path.split('/').pop() || entry.path

  return {
    externalId: entry.path,
    title,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `sftp://${ctx.host}:${ctx.port}${entry.path}`,
    contentHash: `sftp:${entry.path}:${entry.mtime}:${entry.size}`,
    metadata: {
      path: entry.path,
      directory: entry.directory,
      extension: getExtension(entry.path),
      fileSize: entry.size,
      lastModified: new Date(entry.mtime * 1000).toISOString(),
    },
  }
}

/**
 * Heuristic binary check: a NUL byte in the leading bytes of a file never occurs
 * in the UTF-8 text formats this connector indexes.
 */
function looksBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < end; i++) {
    if (buffer[i] === 0) return true
  }
  return false
}

export const sftpConnector: ConnectorConfig = {
  ...sftpConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    _cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const ctx = resolveContext(accessToken, sourceConfig)

    logger.info('Listing SFTP files', {
      host: ctx.host,
      rootPath: ctx.rootPath,
      incremental: Boolean(lastSyncAt),
    })

    const { files, truncated } = await withSftpSession(ctx, LISTING_TIMEOUT_MS, (sftp) =>
      walkTree(sftp, ctx, lastSyncAt)
    )

    const documents = files.map((entry) =>
      stubOrSkipBySize(fileToStub(ctx, entry), entry.size, MAX_FILE_SIZE)
    )

    /**
     * A truncated walk means still-present files are absent from this listing.
     * Without this flag the sync engine would hard-delete every document past
     * the cap.
     */
    if (truncated && syncContext) syncContext.listingCapped = true

    return { documents, hasMore: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const ctx = resolveContext(accessToken, sourceConfig)

    /**
     * These two rejections throw rather than resolve `null`. `null` is the
     * connector contract's "the document is gone at the source", which the sync
     * engine acts on by letting the document be reconciled away; a path this
     * connector refuses to address is instead a configuration or tampering
     * fault, and must surface as a visible failed row.
     */
    if (!isPathSafe(externalId)) {
      throw new Error(`Refusing SFTP path with traversal sequences: ${externalId}`)
    }
    const remotePath = normalizeRemotePath(externalId)
    if (!isWithinRoot(remotePath, ctx.rootPath)) {
      throw new Error(`Refusing SFTP path outside the configured root: ${remotePath}`)
    }

    return await withSftpSession(ctx, DOCUMENT_TIMEOUT_MS, async (sftp) => {
      const stats = await statRemotePath(sftp, remotePath, { follow: false })
      if (!stats) return null
      /**
       * `lstat` above means a symlink reports as `symlink`, not as whatever it
       * points at, so a link swapped in under the root between listing and
       * fetch is rejected here rather than read through.
       */
      if (getFileType(stats) !== 'file') return null

      const size = stats.size ?? 0
      const entry: SftpFileEntry = {
        path: remotePath,
        directory: remotePath.slice(0, remotePath.lastIndexOf('/')) || '/',
        size,
        mtime: stats.mtime ?? 0,
      }
      const stub = fileToStub(ctx, entry)

      if (size > MAX_FILE_SIZE) {
        logger.warn('Skipping oversized SFTP file', { remotePath, size })
        return markSkipped(stub, sizeLimitSkipReason(MAX_FILE_SIZE))
      }

      let buffer: Buffer
      try {
        buffer = await readSftpFileCapped(sftp, remotePath, MAX_FILE_SIZE, 'SFTP connector sync')
      } catch (error) {
        /**
         * The reported `stat` size is attacker-controlled, so a server can
         * understate it and then stream unbounded data. `readSftpFileCapped`
         * destroys the stream at the cap and throws, which lands here.
         */
        if (isPayloadSizeLimitError(error)) {
          logger.warn('SFTP file exceeded the size cap while streaming', { remotePath })
          return markSkipped(stub, sizeLimitSkipReason(MAX_FILE_SIZE))
        }
        /**
         * The file was removed between the listing and this read. That is an
         * absence, not a failure, so it resolves null; every other error is
         * rethrown so the sync records a failed document instead of silently
         * dropping one.
         */
        if (isNotFoundError(error)) {
          logger.warn('SFTP file disappeared before it could be read', { remotePath })
          return null
        }
        throw error
      }

      if (looksBinary(buffer)) {
        logger.warn('Skipping binary SFTP file', { remotePath })
        return markSkipped(stub, 'File appears to be binary and was not indexed')
      }

      const raw = buffer.toString('utf-8')
      const content = HTML_EXTENSIONS.has(getExtension(remotePath)) ? htmlToPlainText(raw) : raw
      if (!content.trim()) return null

      return { ...stub, content, contentDeferred: false }
    })
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    let ctx: SftpContext
    try {
      ctx = resolveContext(accessToken, sourceConfig)
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Invalid configuration') }
    }

    try {
      const valid = await withSftpSession(ctx, DOCUMENT_TIMEOUT_MS, async (sftp) => {
        const stats = await statRemotePath(sftp, ctx.rootPath, { follow: true })
        if (!stats) return false
        return getFileType(stats) === 'directory'
      })
      if (!valid) {
        return { valid: false, error: `Root path is not an accessible directory: ${ctx.rootPath}` }
      }
      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to connect to the SFTP server') }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.directory === 'string' && metadata.directory.length > 0) {
      result.directory = metadata.directory
    }

    if (typeof metadata.extension === 'string' && metadata.extension.length > 0) {
      result.extension = metadata.extension
    }

    if (metadata.fileSize != null) {
      const num = Number(metadata.fileSize)
      if (!Number.isNaN(num)) result.fileSize = num
    }

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    return result
  },
}
