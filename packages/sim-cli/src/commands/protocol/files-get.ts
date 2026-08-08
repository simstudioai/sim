import { once } from 'node:events'
import { createWriteStream, type WriteStream } from 'node:fs'
import { basename } from 'node:path'
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
        `${file.path} already exists. Pass --force to overwrite, or -o to write elsewhere.`,
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

export function attachFileGet(files: Command): void {
  files
    .command('get <fileId>')
    .description('Get a file’s content')
    .option('-o, --output-file <path>', 'Where to write it (default: file name; -: stdout)')
    .option('--force', 'Overwrite the destination if it already exists')
    .action(
      async (
        fileId: string,
        options: { outputFile?: string; force?: boolean },
        command: Command
      ) => {
        if (options.outputFile === '-' && options.force) {
          throw new SimApiError('--force cannot be used when --output-file is -', 0)
        }

        const { client, profile } = clientFrom(command)
        const workspaceId = client.requireWorkspace()
        const operation = V2_OPERATIONS.getFileContent
        const response = await client.requestRaw(resolvePath(operation.path, { fileId }), {
          method: operation.method,
          query: { workspaceId },
        })
        if (!response.body) {
          throw new SimApiError('File content response was empty.', response.status)
        }

        if (options.outputFile === '-') {
          await streamToStdout(response.body)
          return
        }

        const target =
          options.outputFile ??
          basename(
            /filename="?([^";]+)"?/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
              fileId
          )

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
