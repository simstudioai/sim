import { once } from 'node:events'
import { createWriteStream, type WriteStream } from 'node:fs'
import { link, lstat, mkdtemp, readlink, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Command } from 'commander'
import { clientFrom } from '../../context'
import { V2_OPERATIONS } from '../../generated/v2-api'
import { isRequestTimeout, RAISE_TIMEOUT_HINT, resolvePath, SimApiError } from '../../http/client'
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

async function saveStagedFile(
  body: ReadableStream<Uint8Array>,
  target: string,
  force: boolean
): Promise<void> {
  let temporaryDirectory: string | null = null
  let failure: SimApiError | null = null

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
}

/** Publishes a complete staged body atomically, with overwrite requiring explicit force. */
export async function saveToFile(
  body: ReadableStream<Uint8Array>,
  target: string,
  force: boolean
): Promise<void> {
  return saveStagedFile(body, target, force)
}

/** Streams a fetch body to stdout without closing the process-wide stream. */
export async function streamToStdout(
  body: ReadableStream<Uint8Array>,
  output: NodeJS.WriteStream = process.stdout
): Promise<void> {
  const reader = body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      if (!output.write(value)) await once(output, 'drain')
    }
  } finally {
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

export function attachFileGet(files: Command): void {
  files
    .command('get')
    .argument('<fileId>', 'File whose content to read')
    .allowExcessArguments(false)
    .description('Get a file’s content')
    .option('-o, --output-file <path>', 'Write content to a file instead of stdout')
    .option('--force', 'Overwrite --output-file if it already exists')
    .action(
      async (
        fileId: string,
        options: { outputFile?: string; force?: boolean },
        command: Command
      ) => {
        const writesToStdout = options.outputFile === undefined || options.outputFile === '-'
        if (writesToStdout && options.force) {
          throw new SimApiError('--force requires --output-file <path>', 0)
        }

        const { client, profile } = clientFrom(command)
        const workspaceId = client.requireWorkspace()
        const operation = V2_OPERATIONS.downloadFile
        const response = await client.requestRaw(resolvePath(operation.path, { fileId }), {
          method: operation.method,
          query: { workspaceId },
        })
        if (!response.body) {
          throw new SimApiError('File content response was empty.', response.status)
        }

        if (options.outputFile === undefined || options.outputFile === '-') {
          const contentType = response.headers.get('content-type')
          if (process.stdout.isTTY && !isTerminalSafeContentType(contentType)) {
            await response.body.cancel()
            throw new SimApiError(
              `Refusing to write ${contentType ?? 'unknown content'} to an interactive terminal. Use --output-file <path> or pipe stdout.`,
              0
            )
          }

          await streamToStdout(response.body)
          return
        }

        const target = options.outputFile

        await saveToFile(response.body, target, Boolean(options.force))
        printProtocolResult(profile.output, {
          id: fileId,
          path: target,
          status: 'saved',
        })
      }
    )
}
