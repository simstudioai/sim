import { once } from 'node:events'
import { createWriteStream, type WriteStream } from 'node:fs'
import { basename } from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import { clientFrom } from '../context.js'
import { SimApiError } from '../http/client.js'
import { bytes, type Column, printList, timestamp } from '../output/render.js'

interface WorkspaceFile {
  id: string
  name: string
  size: number
  type: string
  key: string
  uploadedBy: string
  uploadedAt: string
}

/**
 * Streams a fetch body to disk, honouring backpressure.
 *
 * Written as an explicit reader loop rather than `Readable.fromWeb`: the DOM
 * `ReadableStream` that `fetch` returns and the one `node:stream/web` declares
 * are structurally incompatible under this TS config, and bridging them needs a
 * cast that would erase exactly the typing this loop keeps honest.
 */
async function streamToFile(body: ReadableStream<Uint8Array>, file: WriteStream): Promise<void> {
  const reader = body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // `write` returning false means the internal buffer is full; waiting for
      // `drain` is what stops a large file from being buffered in memory.
      if (!file.write(value)) await once(file, 'drain')
    }
  } finally {
    reader.releaseLock()
  }

  await new Promise<void>((resolve, reject) => {
    file.once('error', reject)
    file.end(resolve)
  })
}

const LIST_COLUMNS: Column<WorkspaceFile>[] = [
  { header: 'id', value: (file) => file.id },
  { header: 'name', value: (file) => file.name },
  { header: 'size', value: (file) => bytes(file.size) },
  { header: 'type', value: (file) => file.type },
  { header: 'uploaded', value: (file) => timestamp(file.uploadedAt) },
]

export function filesCommand(): Command {
  const files = new Command('files').alias('file').description('List and download workspace files')

  files
    .command('list')
    .alias('ls')
    .description('List files in a workspace')
    .option('--limit <n>', 'Maximum files to return', '100')
    .action(async (options: { limit: string }, command: Command) => {
      const { client, profile } = clientFrom(command)
      const limit = Number.parseInt(options.limit, 10)

      const rows = await client.collect<WorkspaceFile>(
        '/api/v2/files',
        { query: { workspaceId: client.requireWorkspace(), limit: Math.min(limit, 1000) } },
        limit
      )

      printList(profile.output, rows, LIST_COLUMNS)
    })

  files
    .command('download <fileId>')
    .description('Download a file')
    .option('-o, --output-file <path>', 'Where to write it (defaults to the file name)')
    .action(async (fileId: string, options: { outputFile?: string }, command: Command) => {
      const { client, profile } = clientFrom(command)
      const workspaceId = client.requireWorkspace()

      if (!profile.apiKey) {
        throw new SimApiError(`Not logged in on profile "${profile.name}". Run: sim login`, 0)
      }

      // Streamed rather than routed through the JSON client: the response is
      // binary of unbounded size, so buffering it just to write it out would put
      // the whole file in memory.
      const url = new URL(`${profile.endpoint}/api/v2/files/${fileId}`)
      url.searchParams.set('workspaceId', workspaceId)

      const response = await fetch(url, { headers: { 'x-api-key': profile.apiKey } })
      if (!response.ok || !response.body) {
        const raw = await response.text().catch(() => '')
        throw new SimApiError(
          raw || `Download failed with status ${response.status}`,
          response.status
        )
      }

      const target =
        options.outputFile ??
        basename(
          // `filename="…"` from the route's content-disposition, when present.
          /filename="?([^";]+)"?/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
            fileId
        )

      await streamToFile(response.body, createWriteStream(target))
      console.log(chalk.green(`✓ Saved ${target}`))
    })

  files
    .command('delete <fileId>')
    .description('Archive a file')
    .action(async (fileId: string, _options: unknown, command: Command) => {
      const { client } = clientFrom(command)
      await client.getData(`/api/v2/files/${fileId}`, {
        method: 'DELETE',
        query: { workspaceId: client.requireWorkspace() },
      })
      console.log(chalk.green(`✓ Deleted ${fileId}`))
    })

  return files
}
