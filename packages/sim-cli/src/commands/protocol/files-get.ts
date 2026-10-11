import { once } from 'node:events'
import { createWriteStream, rmSync, type WriteStream } from 'node:fs'
import { link, lstat, mkdtemp, readlink, rename, rm } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Command } from 'commander'
import { writeStdout } from '#sim-cli/output/io'
import { embedStore } from '../../embed-context'
import { V2_OPERATIONS } from '../../generated/v2-api'
import {
  isRequestTimeout,
  RAISE_TIMEOUT_HINT,
  type RequestOptions,
  SimApiError,
} from '../../http/client'
import { describeOperation } from '../../runtime/build'
import { apiCommand, type Connection } from '../../runtime/called-operations'
import { buildRequest, readArgumentSource } from '../../runtime/request'
import { printProtocolResult } from './result'

function writeFailure(path: WriteStream['path'], error: unknown): SimApiError {
  // A body torn down by the request's own bound is not a disk problem. Calling
  // it "could not write" sent the reader to check permissions and free space
  // for a timeout they can raise, and hid the one instruction that resolves it.
  if (isRequestTimeout(error)) {
    return new SimApiError(`Downloading ${path} timed out. ${RAISE_TIMEOUT_HINT}`, 0)
  }

  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EEXIST') {
    return new SimApiError(
      `${path} already exists. Pass --force to overwrite it, or choose another output path.`,
      0
    )
  }
  return new SimApiError(`Could not write ${path}: ${(error as Error).message}`, 0)
}

async function forcedPublicationTarget(target: string): Promise<string> {
  let candidate = target
  const visited = new Set<string>()

  while (true) {
    const absoluteCandidate = resolve(candidate)
    if (visited.has(absoluteCandidate)) {
      throw Object.assign(new Error(`Symbolic link loop at ${target}`), { code: 'ELOOP' })
    }
    visited.add(absoluteCandidate)

    let metadata
    try {
      metadata = await lstat(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate
      throw error
    }

    if (!metadata.isSymbolicLink()) return candidate
    candidate = resolve(dirname(candidate), await readlink(candidate))
  }
}

function normalizedWriteFailure(target: string, error: unknown): SimApiError {
  return error instanceof SimApiError ? error : writeFailure(target, error)
}

function combinedCleanupFailure(
  failure: SimApiError,
  temporaryPath: string,
  cleanupError: unknown
): SimApiError {
  return new SimApiError(
    `${failure.message} Cleanup also failed for ${temporaryPath}: ${(cleanupError as Error).message}`,
    0
  )
}

function unsupportedAtomicPublish(target: string, error: unknown): SimApiError | null {
  const code = (error as NodeJS.ErrnoException).code
  if (!['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(code ?? '')) return null
  return new SimApiError(
    `Could not publish ${target} without overwrite protection because this filesystem does not support atomic hard links. Re-run with --force to publish the completed download with an atomic rename.`,
    0
  )
}

/** Streams a fetch body to disk while honoring write-stream backpressure. */
export async function streamToFile(
  body: ReadableStream<Uint8Array>,
  file: Writable & Pick<WriteStream, 'path'>,
  reportedPath: WriteStream['path'] = file.path
): Promise<void> {
  try {
    await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), file)
  } catch (error) {
    throw writeFailure(reportedPath, error)
  }
}

/** Signals that end the process while a download is staged beside its target. */
const STAGE_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM']

/**
 * Ends the process by the signal that arrived, once our own handler has run.
 *
 * Installing a listener suppresses Node's default termination, so the handler
 * has to terminate itself. Re-raising rather than `process.exit(130)` keeps the
 * process dying *by signal*, so a wrapping shell still sees 130/143 and a
 * `trap` still fires — the behaviour an interrupted download has today. Only
 * our own listener is removed, by the handler itself before it calls this:
 * `removeAllListeners` would take a caller's own handler with it, and nothing
 * here needs one gone but ours.
 */
function reRaise(signal: NodeJS.Signals): void {
  process.kill(process.pid, signal)
}

/**
 * Removes the staging directory when a signal ends the process.
 *
 * `saveStagedFile` cleans up in normal control flow, which a signal never
 * reaches: the process is torn down mid-`pipeline`, so every Ctrl-C left
 * another `.sim-download-*` holding a partial payload beside the destination.
 * The removal is synchronous because the termination that follows gives an
 * async `rm` no turn to run.
 *
 * Exported for its own test: driving it through a real interrupt would take the
 * test runner down with it.
 */
export function removeStagingOnSignal(
  stagingDirectory: () => string | null,
  terminate: (signal: NodeJS.Signals) => void = reRaise
): () => void {
  const installed = STAGE_SIGNALS.map((signal) => {
    const onSignal = () => {
      process.off(signal, onSignal)
      const directory = stagingDirectory()
      if (directory) {
        try {
          rmSync(directory, { recursive: true, force: true })
        } catch {
          // A staging directory we cannot remove is not worth masking the
          // interrupt the caller asked for.
        }
      }
      terminate(signal)
    }
    process.on(signal, onSignal)
    return [signal, onSignal] as const
  })

  return () => {
    for (const [signal, onSignal] of installed) process.off(signal, onSignal)
  }
}

async function saveStagedFile(
  body: ReadableStream<Uint8Array>,
  target: string,
  force: boolean
): Promise<void> {
  let temporaryDirectory: string | null = null
  let failure: SimApiError | null = null
  const disposeSignalCleanup = removeStagingOnSignal(() => temporaryDirectory)

  try {
    try {
      const publicationTarget = force ? await forcedPublicationTarget(target) : target
      temporaryDirectory = await mkdtemp(join(dirname(publicationTarget), '.sim-download-'))
      const temporaryPath = join(temporaryDirectory, 'payload')
      await streamToFile(body, createWriteStream(temporaryPath, { flags: 'wx' }), target)
      if (force) {
        await rename(temporaryPath, publicationTarget)
      } else {
        try {
          await link(temporaryPath, publicationTarget)
        } catch (error) {
          throw unsupportedAtomicPublish(target, error) ?? error
        }
      }
    } catch (error) {
      failure = normalizedWriteFailure(target, error)
    }

    if (temporaryDirectory) {
      try {
        await rm(temporaryDirectory, { recursive: true, force: true })
      } catch (cleanupError) {
        if (failure) throw combinedCleanupFailure(failure, temporaryDirectory, cleanupError)
        throw new SimApiError(
          `Saved ${target}, but could not remove temporary directory ${temporaryDirectory}: ${(cleanupError as Error).message}`,
          0
        )
      }
    }

    if (failure) throw failure
  } finally {
    // Disposed on every path out, and only once the removal above has finished:
    // an `rm` is asynchronous, so a handler disposed before it awaits leaves the
    // staging directory behind for a signal arriving in exactly the window this
    // watch exists for.
    disposeSignalCleanup()
  }
}

/** Publishes a complete staged body atomically, with overwrite requiring explicit force. */
export async function saveToFile(
  body: ReadableStream<Uint8Array>,
  target: string,
  force: boolean
): Promise<string> {
  const embedded = embedStore.getStore()
  if (embedded) {
    try {
      if (embedded.workingDirectory) {
        if (!posix.isAbsolute(embedded.workingDirectory))
          throw new SimApiError('The caller working directory must be absolute.', 0)
        target = posix.resolve(embedded.workingDirectory, target)
      }
      embedded.identity.signal?.throwIfAborted()
      if (!embedded.writeFile) {
        throw new SimApiError(
          `--output-file cannot save ${target} here: this surface has no machine to write to. Read the file instead, or use a client with filesystem access to download it.`,
          0
        )
      }
      await embedded.writeFile(target, body, { overwrite: force })
      embedded.identity.signal?.throwIfAborted()
    } finally {
      /** The host releases its reader; refusal and early failure must also close the source. */
      await body.cancel().catch(() => {})
    }
    return target
  }
  target = resolve(target)
  await saveStagedFile(body, target, force)
  return target
}

/** Streams a fetch body to stdout without closing the process-wide stream. */
export async function streamToStdout(
  body: ReadableStream<Uint8Array>,
  output?: NodeJS.WriteStream
): Promise<void> {
  const reader = body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      if (output) {
        if (!output.write(value)) await once(output, 'drain')
      } else if (!writeStdout(value)) {
        await once(process.stdout, 'drain')
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Returns whether content can be written directly to an interactive terminal. */
export function isTerminalSafeContentType(contentType: string | null): boolean {
  if (!contentType) return false

  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase()
  return (
    mediaType.startsWith('text/') ||
    mediaType.endsWith('+json') ||
    mediaType.endsWith('+xml') ||
    [
      'application/graphql',
      'application/javascript',
      'application/json',
      'application/sql',
      'application/x-javascript',
      'application/x-yaml',
      'application/xml',
      'application/yaml',
      'image/svg+xml',
    ].includes(mediaType)
  )
}

interface DownloadOutputOptions {
  outputFile?: string
  force?: boolean
}

type DownloadOperation =
  | 'downloadFile'
  | 'downloadFileVersion'
  | 'downloadProjectFileItems'
  | 'exportProjectFileSnapshot'
  | 'readProjectFileContent'
  | 'readProjectFileVersionContent'

/**
 * Streams a binary v2 download to stdout or atomically to `--output-file`. Shared by every
 * command that downloads file bytes, so each gets the same terminal guard and overwrite rules.
 */
async function downloadToOutput<Operation extends DownloadOperation>(
  connect: () => Connection<Operation>,
  operation: Operation,
  pathParams: Record<string, string>,
  options: DownloadOutputOptions,
  scope: 'workspace' | 'owner',
  requestInput: Pick<RequestOptions, 'query' | 'body'> = {}
): Promise<void> {
  const target = options.outputFile
  const writesToStdout = target === undefined || target === '-'
  if (writesToStdout && options.force) {
    throw new SimApiError('--force requires --output-file <path>', 0)
  }

  const { client, profile } = connect()
  const response = await client.requestRaw(operation, {
    params: pathParams,
    ...requestInput,
    ...(scope === 'workspace' ? { query: { workspaceId: client.requireWorkspace() } } : {}),
  })
  if (!response.body) {
    throw new SimApiError('File content response was empty.', response.status)
  }

  if (writesToStdout) {
    const contentType = response.headers.get('content-type')
    const embedded = embedStore.getStore()
    if ((embedded || process.stdout.isTTY) && !isTerminalSafeContentType(contentType)) {
      await response.body.cancel()
      throw new SimApiError(
        embedded
          ? `Refusing to put ${contentType ?? 'unknown content'} in a text result. Use --output-file <path>.`
          : `Refusing to write ${contentType ?? 'unknown content'} to an interactive terminal. Use --output-file <path> or pipe stdout.`,
        0
      )
    }

    await streamToStdout(response.body)
    return
  }

  const savedTarget = await saveToFile(response.body, target, Boolean(options.force))
  printProtocolResult(profile.output, {
    ...(pathParams.fileId ? { id: pathParams.fileId } : {}),
    path: savedTarget,
    status: 'saved',
  })
}

interface ProjectFileDownloadOptions extends DownloadOutputOptions {
  fileIds?: string[]
  folderIds?: string[]
}

/** Owner-specific selection uses the same bounded transfer and atomic output path as file reads. */
export function attachProjectFileDownload(files: Command): void {
  const [command, connect] = apiCommand(files, 'bulk-download', ['downloadProjectFileItems'])
  command
    .argument('<projectId>', 'Project that owns the files')
    .allowExcessArguments(false)
    .description(
      describeOperation(
        V2_OPERATIONS.downloadProjectFileItems,
        'Download Project files and recursive folder contents as a zip archive'
      )
    )
    .option('--file-ids <id...>', 'File identifiers to include')
    .option('--folder-ids <id...>', 'Folder identifiers to include recursively')
    .option('-o, --output-file <path>', 'Write the archive to a file instead of stdout')
    .option('--force', 'Overwrite --output-file if it already exists')
    .action(async (projectId: string, options: ProjectFileDownloadOptions) => {
      const input = await buildRequest(
        'downloadProjectFileItems',
        [projectId],
        { ...options },
        null
      )
      await downloadToOutput(connect, 'downloadProjectFileItems', { projectId }, options, 'owner', {
        query: input.query,
      })
    })
}

interface ProjectFileSnapshotOptions extends DownloadOutputOptions {
  content: string
}

/** Snapshot text comes from the caller's file reader, including the embedded workbench boundary. */
export function attachProjectFileSnapshotExport(files: Command): void {
  const [command, connect] = apiCommand(files, 'export', ['exportProjectFileSnapshot'])
  command
    .argument('<projectId>', 'Project that owns the file')
    .argument('<fileId>', 'Markdown file whose visible snapshot to export')
    .allowExcessArguments(false)
    .description(
      describeOperation(
        V2_OPERATIONS.exportProjectFileSnapshot,
        'Export a visible Project Markdown snapshot with its embedded assets'
      )
    )
    .requiredOption('--content <text|@file|@->', 'Visible Markdown content or a file to read')
    .option('-o, --output-file <path>', 'Write the export to a file instead of stdout')
    .option('--force', 'Overwrite --output-file if it already exists')
    .action(async (projectId: string, fileId: string, options: ProjectFileSnapshotOptions) => {
      const source = await readArgumentSource(options.content, 'content')
      await downloadToOutput(
        connect,
        'exportProjectFileSnapshot',
        { projectId, fileId },
        options,
        'owner',
        { body: { content: source.text } }
      )
    })
}

export function attachFileGet(files: Command): void {
  const [command, connect] = apiCommand(files, 'get', ['downloadFile'])
  command
    .argument('<fileId>', 'File whose content to read')
    .allowExcessArguments(false)
    .description('Download a file’s content to stdout or a local file')
    .option('-o, --output-file <path>', 'Write content to a file instead of stdout')
    .option('--force', 'Overwrite --output-file if it already exists')
    .action((fileId: string, options: DownloadOutputOptions) =>
      downloadToOutput(connect, 'downloadFile', { fileId }, options, 'workspace')
    )
}

export function attachFileVersionDownload(versions: Command): void {
  const [command, connect] = apiCommand(versions, 'download', ['downloadFileVersion'])
  command
    .argument('<fileId>', 'File identifier.')
    .argument('<version>', 'Version number.')
    .allowExcessArguments(false)
    .description('Download the content of one version of a file')
    .option('-o, --output-file <path>', 'Write content to a file instead of stdout')
    .option('--force', 'Overwrite --output-file if it already exists')
    .action((fileId: string, version: string, options: DownloadOutputOptions) =>
      downloadToOutput(connect, 'downloadFileVersion', { fileId, version }, options, 'workspace')
    )
}

/** Project source downloads share transfer protections without selecting a workspace. */
export function attachProjectFileSource(files: Command): void {
  const [command, connect] = apiCommand(files, 'source', ['readProjectFileContent'])
  command
    .argument('<projectId>', 'Project that owns the file')
    .argument('<fileId>', 'File whose stored source to read')
    .allowExcessArguments(false)
    .description(
      describeOperation(
        V2_OPERATIONS.readProjectFileContent,
        'Download a Project file’s stored source to stdout or a local file'
      )
    )
    .option('-o, --output-file <path>', 'Write content to a file instead of stdout')
    .option('--force', 'Overwrite --output-file if it already exists')
    .action((projectId: string, fileId: string, options: DownloadOutputOptions) =>
      downloadToOutput(connect, 'readProjectFileContent', { projectId, fileId }, options, 'owner')
    )
}

export function attachProjectFileVersionSource(versions: Command): void {
  const [command, connect] = apiCommand(versions, 'source', ['readProjectFileVersionContent'])
  command
    .argument('<projectId>', 'Project that owns the file')
    .argument('<fileId>', 'File identifier.')
    .argument('<version>', 'Version number.')
    .allowExcessArguments(false)
    .description(
      describeOperation(
        V2_OPERATIONS.readProjectFileVersionContent,
        'Download a Project file version’s stored source to stdout or a local file'
      )
    )
    .option('-o, --output-file <path>', 'Write content to a file instead of stdout')
    .option('--force', 'Overwrite --output-file if it already exists')
    .action((projectId: string, fileId: string, version: string, options: DownloadOutputOptions) =>
      downloadToOutput(
        connect,
        'readProjectFileVersionContent',
        { projectId, fileId, version },
        options,
        'owner'
      )
    )
}
