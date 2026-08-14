import { once } from 'node:events'
import { createWriteStream, type WriteStream } from 'node:fs'
import type { Command } from 'commander'
import { clientFrom } from '../../context.js'
import { V2_OPERATIONS } from '../../generated/v2-api.js'
import { resolvePath, SimApiError } from '../../http/client.js'
import { printProtocolResult } from './result.js'

/** Streams a fetch body to disk while honoring write-stream backpressure. */
export async function streamToFile(
  body: ReadableStream<Uint8Array>,
  file: WriteStream
): Promise<void> {
  const failed = new Promise<never>((_resolve, reject) => {
    file.once('error', reject)
  })

  const pump = (async () => {
    const reader = body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!file.write(value)) await once(file, 'drain')
      }
    } finally {
      reader.releaseLock()
    }

    await new Promise<void>((resolve, reject) => {
      file.end((error?: Error | null) => (error ? reject(error) : resolve()))
    })
  })()

  try {
    await Promise.race([pump, failed])
  } catch (error) {
    file.destroy()
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      throw new SimApiError(
        `${file.path} already exists. Pass --force to overwrite it, or choose another output path.`,
        0
      )
    }
    throw new SimApiError(`Could not write ${file.path}: ${(error as Error).message}`, 0)
  }
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
    .command('get <fileId>')
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

        await streamToFile(
          response.body,
          createWriteStream(target, { flags: options.force ? 'w' : 'wx' })
        )
        printProtocolResult(profile.output, {
          id: fileId,
          path: target,
          status: 'saved',
        })
      }
    )
}
