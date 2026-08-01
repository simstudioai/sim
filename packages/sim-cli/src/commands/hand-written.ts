import { once } from 'node:events'
import { createWriteStream, type WriteStream } from 'node:fs'
import { basename } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { clientFrom } from '../context.js'
import type { QueryRowsResponse } from '../generated/v2-api.js'
import { SimApiError } from '../http/client.js'
import { type Column, printList, text } from '../output/render.js'

/**
 * Commands the generated runtime cannot produce.
 *
 * Kept deliberately small — each entry needs a reason that generation could not
 * satisfy even in principle, not merely "not migrated yet". They attach onto the
 * groups the runtime already built, so `sim files --help` lists them alongside
 * the generated leaves rather than in a second group.
 */

type Row = QueryRowsResponse['data'][number]

/**
 * Streams a fetch body to disk, honouring backpressure.
 *
 * An explicit reader loop rather than `Readable.fromWeb`: the DOM
 * `ReadableStream` that `fetch` returns and the one `node:stream/web` declares
 * are structurally incompatible under this TS config, and bridging them needs a
 * cast that would erase exactly the typing this keeps honest.
 */
async function streamToFile(body: ReadableStream<Uint8Array>, file: WriteStream): Promise<void> {
  const reader = body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // `write` returning false means the buffer is full; waiting for `drain` is
      // what stops a large file being buffered entirely in memory.
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

/**
 * Row `data` is name-keyed and user-defined, so columns exist only at runtime.
 * Keys are unioned across the page rather than read off the first row — a
 * sparse row would otherwise hide every column it happens to omit.
 */
function rowColumns(rows: Row[]): Column<Row>[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row.data)) {
      if (seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }
  }

  return [
    { header: 'id', value: (row) => row.id },
    ...keys.map((key) => ({
      header: key,
      value: (row: Row) => {
        const value = row.data[key]
        if (value === null || value === undefined) return text(null)
        return typeof value === 'object' ? JSON.stringify(value) : String(value)
      },
    })),
  ]
}

function group(program: Command, name: string): Command {
  const existing = program.commands.find((command) => command.name() === name)
  if (existing) return existing
  const created = program.command(name)
  return created
}

export function attachHandWritten(program: Command): void {
  // ── files download ── the response is binary, not the JSON envelope ────────
  group(program, 'files')
    .command('download <fileId>')
    .description('Download a file')
    .option('-o, --output-file <path>', 'Where to write it (defaults to the file name)')
    .action(async (fileId: string, options: { outputFile?: string }, command: Command) => {
      const { client, profile } = clientFrom(command)
      const workspaceId = client.requireWorkspace()

      if (!profile.apiKey) {
        throw new SimApiError(`Not logged in on profile "${profile.name}". Run: sim login`, 0)
      }

      const url = new URL(`${profile.endpoint}/api/v2/files/${encodeURIComponent(fileId)}`)
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
          /filename="?([^";]+)"?/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
            fileId
        )

      await streamToFile(response.body, createWriteStream(target))
      console.log(chalk.green(`✓ Saved ${target}`))
    })

  // ── tables rows list ── columns come from user-defined row data ───────────
  const tables = group(program, 'tables')
  const rows =
    tables.commands.find((command) => command.name() === 'rows') ?? tables.command('rows')
  rows
    .command('list <tableId>')
    .description('List rows, with columns discovered from the data')
    .option('--limit <n>', 'Maximum rows to return (0 for everything)', '100')
    .action(async (tableId: string, options: { limit: string }, command: Command) => {
      const { client, profile } = clientFrom(command)
      const parsed = Number.parseInt(options.limit, 10)
      if (Number.isNaN(parsed) || parsed < 0) {
        throw new SimApiError('--limit must be a non-negative number', 0)
      }
      const limit = parsed === 0 ? Number.POSITIVE_INFINITY : parsed

      const collected: Row[] = []
      let cursor: string | null = null
      do {
        const page = (await client.request(`/api/v2/tables/${encodeURIComponent(tableId)}/rows`, {
          query: { workspaceId: client.requireWorkspace(), cursor },
        })) as QueryRowsResponse
        collected.push(...page.data)
        cursor = page.nextCursor
      } while (cursor && collected.length < limit)

      const page = Number.isFinite(limit) ? collected.slice(0, limit) : collected
      printList(profile.output, page, rowColumns(page))
    })
}
