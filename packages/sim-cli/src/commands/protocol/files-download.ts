import { once } from 'node:events'
import { createWriteStream, type WriteStream } from 'node:fs'
import { basename } from 'node:path'
import type { Command } from 'commander'
import { clientFrom } from '../../context.js'
import { SimApiError } from '../../http/client.js'
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

export function attachFileDownload(files: Command): void {
  files
    .command('download <fileId>')
    .description('Download a file')
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

        if (!profile.apiKey) {
          throw new SimApiError(`Not logged in on profile "${profile.name}". Run: sim login`, 0)
        }

        const url = new URL(`${profile.endpoint}/api/v2/files/${encodeURIComponent(fileId)}`)
        url.searchParams.set('workspaceId', workspaceId)

        // boundary-raw-fetch: binary download cannot pass through the JSON client
        const response = await fetch(url, {
          headers: { 'x-api-key': profile.apiKey },
        })
        if (!response.ok || !response.body) {
          const raw = await response.text().catch(() => '')
          throw new SimApiError(
            raw || `Download failed with status ${response.status}`,
            response.status
          )
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
