import { once } from 'node:events'
import { createWriteStream, openAsBlob, type WriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { clientFrom } from '../context.js'
import type { QueryRowsResponse } from '../generated/v2-api.js'
import { SimApiError, type SimClient } from '../http/client.js'
import { type Column, printList, sanitize, text } from '../output/render.js'
import { coerce } from '../runtime/request.js'

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
export async function streamToFile(
  body: ReadableStream<Uint8Array>,
  file: WriteStream
): Promise<void> {
  // Registered before the first write, not after the loop. `createWriteStream`
  // opens lazily, so an EEXIST/EACCES/ENOSPC can surface at any point — with no
  // listener attached it is an unhandled 'error' event that takes down the
  // process instead of failing the download.
  const failed = new Promise<never>((_resolve, reject) => {
    file.once('error', reject)
  })

  const pump = (async () => {
    const reader = body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        // `write` returning false means the buffer is full; waiting for `drain`
        // is what stops a large file being buffered entirely in memory.
        if (!file.write(value)) await once(file, 'drain')
      }
    } finally {
      reader.releaseLock()
    }

    // `end`'s callback receives the error from a failed final flush (ENOSPC is
    // the common one, since the bytes may not hit disk until here). Passing
    // `resolve` directly made that error the resolution *value*, so the pump
    // fulfilled and the command printed "Saved" for a truncated file.
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
      // A table's column names are user-defined, so the header is remote
      // content just as much as the cell beneath it.
      header: sanitize(key),
      value: (row: Row) => {
        const value = row.data[key]
        if (value === null || value === undefined) return text(null)
        // User-defined cell data is remote content; strip terminal controls.
        return sanitize(typeof value === 'object' ? JSON.stringify(value) : String(value))
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

/**
 * The server stores whatever content type the part carries, falling back to
 * `application/octet-stream`, and that type is what later decides whether the
 * workspace renders a file or offers it as a download. Node does not ship a
 * mime table, so the common cases are listed and everything else falls back.
 */
const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css',
  csv: 'text/csv',
  gif: 'image/gif',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  zip: 'application/zip',
}

function contentTypeFor(name: string): string {
  const dot = name.lastIndexOf('.')
  const extension = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}

interface UploadPartUrl {
  partNumber: number
  url: string
  headers: Record<string, string>
}

/**
 * What a transfer needs to send its bytes, however it was started.
 *
 * File uploads and table imports are the same handshake against different
 * paths — identical part-URL and complete bodies, the same `upload-token`
 * header — so one implementation drives both. `basePath` is the transfer's own
 * resource; `/parts` and `/complete` hang off it and DELETE aborts it.
 */
interface Transfer {
  basePath: string
  uploadToken: string
  partSize: number
  partCount: number
  size: number
}

interface FileUpload {
  id: string
  uploadToken: string
  partSize: number
  partCount: number
  file: { id: string } | null
}

/** The parts endpoint signs at most this many URLs per request. */
const PART_URL_BATCH = 100

/**
 * Sends every part of a file to the storage URLs the API signs for it, and
 * returns what `complete` needs to reassemble them.
 *
 * URLs are requested in batches because each one is short-lived: signing all
 * 640 possible parts up front would leave the last ones expired by the time a
 * slow connection reached them.
 *
 * Parts go out one at a time. Concurrency would be faster, but a failure
 * mid-flight has to abort the whole transfer anyway, and a sequential loop
 * makes "which part failed" unambiguous.
 */
async function uploadParts(
  client: SimClient,
  workspaceId: string,
  transfer: Transfer,
  blob: Blob
): Promise<Array<{ partNumber: number; etag?: string }>> {
  const completed: Array<{ partNumber: number; etag?: string }> = []

  for (let first = 1; first <= transfer.partCount; first += PART_URL_BATCH) {
    const partNumbers = []
    for (let n = first; n < first + PART_URL_BATCH && n <= transfer.partCount; n++) {
      partNumbers.push(n)
    }

    const signed = await client.request<{ data: { parts: UploadPartUrl[] } }>(
      `${transfer.basePath}/parts`,
      {
        method: 'POST',
        query: { workspaceId },
        headers: { 'upload-token': transfer.uploadToken },
        body: { partNumbers },
      }
    )

    for (const part of signed.data.parts) {
      const start = (part.partNumber - 1) * transfer.partSize
      // `Blob.slice` is a view over the file on disk, so only the part being
      // sent is ever read — the point of not buffering the upload.
      const chunk = blob.slice(start, Math.min(start + transfer.partSize, transfer.size))

      // boundary-raw-fetch: storage-signed URL on another origin, not the API
      const response = await fetch(part.url, {
        method: 'PUT',
        headers: part.headers,
        body: chunk,
      })
      if (!response.ok) {
        throw new SimApiError(
          `Part ${part.partNumber} failed with status ${response.status}`,
          response.status
        )
      }

      // S3-compatible stores identify a part by the ETag they return; the API
      // treats it as optional because not every backend sends one.
      const etag = response.headers.get('etag')?.replace(/"/g, '')
      completed.push(etag ? { partNumber: part.partNumber, etag } : { partNumber: part.partNumber })
    }
  }

  return completed
}

/**
 * Runs a started transfer to completion: send the parts, then complete it.
 *
 * Anything that fails in between aborts the transfer, because a half-finished
 * one holds storage the server would otherwise keep until it expires. A failed
 * abort is swallowed — the original failure is what the caller needs to see.
 */
async function finishTransfer<T>(
  client: SimClient,
  workspaceId: string,
  transfer: Transfer,
  path: string
): Promise<T> {
  try {
    const blob = await openAsBlob(path)
    const parts = await uploadParts(client, workspaceId, transfer, blob)

    const completed = await client.request<{ data: T }>(`${transfer.basePath}/complete`, {
      method: 'POST',
      query: { workspaceId },
      headers: { 'upload-token': transfer.uploadToken },
      body: { parts },
    })
    return completed.data
  } catch (error) {
    await client
      .request(transfer.basePath, {
        method: 'DELETE',
        query: { workspaceId },
        headers: { 'upload-token': transfer.uploadToken },
      })
      .catch(() => undefined)
    throw error
  }
}

interface TableImport {
  id: string
  status: 'uploading' | 'queued' | 'processing' | 'completed' | 'failed' | 'canceled' | 'expired'
  tableId: string | null
  rowsProcessed: number
  error: string | null
  upload: { uploadToken: string; partSize: number; partCount: number } | null
}

interface ImportOptions {
  name?: string
  tableId?: string
  mode?: string
  folderId?: string
  fileId?: string
  mapping?: string
  createColumns?: string
  timezone?: string
  /** commander sets this false for `--no-wait`. */
  wait: boolean
}

/**
 * Turns a file name into a legal table name.
 *
 * Table names are identifiers — `^[A-Za-z_][A-Za-z0-9_]*$`, 128 max — so the
 * obvious `basename(path)` would reject most real files: `2026-sales.csv` and
 * `customer data.csv` both fail. Runs of anything else collapse to a single
 * underscore, and a leading digit gets one in front, so a default derived from
 * the file is a name the server actually accepts.
 */
function tableNameFrom(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const cleaned = stem.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!cleaned) return 'imported_table'
  return (/^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned).slice(0, 128)
}

/** How often to ask an in-progress import where it got to. */
const IMPORT_POLL_MS = 1500

/** Statuses the server will not move away from. */
const IMPORT_SETTLED = new Set(['completed', 'failed', 'canceled', 'expired'])

/**
 * Parses a JSON flag through the same path the generated commands use, so
 * `@file` and `@-` work here too rather than only on generated flags.
 */
function jsonFlag(raw: string, flagName: string): unknown {
  return coerce(raw, { kind: 'object' }, { json: true }, flagName)
}

/**
 * Polls an import until it settles.
 *
 * The transfer only queues the work: rows are parsed server-side afterwards, so
 * a command that returned at `complete` would report success for an import that
 * goes on to fail on a malformed row.
 */
async function watchImport(
  client: SimClient,
  workspaceId: string,
  job: TableImport
): Promise<TableImport> {
  let current = job
  let reported = -1

  while (!IMPORT_SETTLED.has(current.status)) {
    await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_MS))
    const next = await client.request<{ data: TableImport }>(
      `/api/v2/tables/imports/${encodeURIComponent(current.id)}`,
      { query: { workspaceId } }
    )
    current = next.data

    // Only on a terminal, and only when it moves: the line rewrites itself with
    // a carriage return, which in a redirected log is just escape noise.
    if (process.stderr.isTTY && current.rowsProcessed !== reported) {
      reported = current.rowsProcessed
      process.stderr.write(`\r${chalk.dim(`${current.status}… ${reported} rows`)}\u001b[K`)
    }
  }

  if (process.stderr.isTTY && reported >= 0) process.stderr.write('\r\u001b[K')
  return current
}

/** Size and name checks every local-file transfer needs before starting one. */
async function localFile(path: string, override?: string): Promise<{ name: string; size: number }> {
  let size: number
  try {
    const stats = await stat(path)
    if (stats.isDirectory()) throw new SimApiError(`${path} is a directory`, 0)
    size = stats.size
  } catch (error) {
    if (error instanceof SimApiError) throw error
    throw new SimApiError(`Cannot read ${path}: ${(error as Error).message}`, 0)
  }
  // A zero-byte transfer has no parts to send; the server cannot accept one.
  if (size === 0) throw new SimApiError(`${path} is empty`, 0)
  return { name: override ?? basename(path), size }
}

export function attachHandWritten(program: Command): void {
  // ── files upload ── a presigned multipart handshake, not one request ──────
  group(program, 'files')
    .command('upload <path>')
    .description('Upload a file to the workspace')
    .option('--folder-id <id>', 'Target folder (defaults to the workspace root)')
    .option('--name <name>', 'Store it under a different name')
    .action(
      async (path: string, options: { folderId?: string; name?: string }, command: Command) => {
        const { client } = clientFrom(command)
        const workspaceId = client.requireWorkspace()
        const { name, size } = await localFile(path, options.name)

        const created = await client.request<{ data: FileUpload }>('/api/v2/files/uploads', {
          method: 'POST',
          body: {
            workspaceId,
            name,
            contentType: contentTypeFor(name),
            size,
            ...(options.folderId ? { folderId: options.folderId } : {}),
          },
        })
        const upload = created.data

        const completed = await finishTransfer<FileUpload>(
          client,
          workspaceId,
          {
            basePath: `/api/v2/files/uploads/${encodeURIComponent(upload.id)}`,
            uploadToken: upload.uploadToken,
            partSize: upload.partSize,
            partCount: upload.partCount,
            size,
          },
          path
        )

        console.log(chalk.green(`✓ Uploaded ${name} (${completed.file?.id ?? completed.id})`))
      }
    )

  // ── tables import ── a transfer, then an async job to watch ──────────────
  group(program, 'tables')
    .command('import [path]')
    .description('Import a CSV, into a new table by default')
    .option('--name <name>', 'Name for the new table (defaults to the file name)')
    .option('--table-id <id>', 'Import into this existing table instead of creating one')
    .option('--mode <append|replace>', 'How to write into --table-id (default: append)')
    .option('--folder-id <id>', 'Folder for the new table')
    .option('--file-id <id>', 'Import a file already in the workspace instead of a local path')
    .option('--mapping <json|@file>', 'Column mapping (--table-id only)')
    .option('--create-columns <json|@file>', 'Columns to create (--table-id only)')
    .option('--timezone <iana>', 'Timezone for date parsing, e.g. America/New_York')
    .option('--no-wait', 'Return once the import is queued instead of watching it')
    .action(async (path: string | undefined, options: ImportOptions, command: Command) => {
      const { client } = clientFrom(command)
      const workspaceId = client.requireWorkspace()

      // The one thing that cannot be inferred: the bytes are either local or
      // already in the workspace, and neither implies the other.
      if (Boolean(path) === Boolean(options.fileId)) {
        throw new SimApiError('Pass exactly one of <path> or --file-id <id>', 0)
      }

      const intoExisting = Boolean(options.tableId)

      // Flags that only mean something for one target. Silently ignoring them
      // would let `--mode replace` read as honoured while a new table is
      // created beside the one it was meant to overwrite.
      const misplaced = intoExisting
        ? ([
            ['--name', options.name],
            ['--folder-id', options.folderId],
          ] as const)
        : ([
            ['--mode', options.mode],
            ['--mapping', options.mapping],
            ['--create-columns', options.createColumns],
          ] as const)
      for (const [flag, value] of misplaced) {
        if (value === undefined) continue
        throw new SimApiError(
          intoExisting
            ? `${flag} applies to a new table; --table-id already names the destination`
            : `${flag} applies to --table-id: a new table takes its name and columns from the CSV`,
          0
        )
      }

      const local = path ? await localFile(path, undefined) : null
      const source = local
        ? {
            type: 'upload',
            name: local.name,
            contentType: contentTypeFor(local.name),
            size: local.size,
          }
        : { type: 'workspace_file', fileId: options.fileId }

      let target: Record<string, unknown>
      if (intoExisting) {
        target = { type: 'existing', tableId: options.tableId, mode: options.mode ?? 'append' }
      } else {
        // A local file names the table; a workspace file id does not, and
        // guessing one from an id would produce nonsense.
        const name = options.name ?? (local ? tableNameFrom(local.name) : undefined)
        if (!name) {
          throw new SimApiError('Pass --name <name> to say what the new table is called', 0)
        }
        target = { type: 'new', name, ...(options.folderId ? { folderId: options.folderId } : {}) }
      }

      const started = await client.request<{ data: TableImport }>('/api/v2/tables/imports', {
        method: 'POST',
        body: {
          workspaceId,
          source,
          target,
          ...(options.mapping ? { mapping: jsonFlag(options.mapping, 'mapping') } : {}),
          ...(options.createColumns
            ? { createColumns: jsonFlag(options.createColumns, 'create-columns') }
            : {}),
          ...(options.timezone ? { timezone: options.timezone } : {}),
        },
      })

      let job = started.data

      // A workspace_file source has nothing to upload — the bytes are already
      // there, and the server starts the job without a transfer.
      if (path && job.upload) {
        job = await finishTransfer<TableImport>(
          client,
          workspaceId,
          {
            basePath: `/api/v2/tables/imports/${encodeURIComponent(job.id)}`,
            uploadToken: job.upload.uploadToken,
            partSize: job.upload.partSize,
            partCount: job.upload.partCount,
            size: local?.size ?? 0,
          },
          path
        )
      }

      if (!options.wait) {
        console.log(chalk.green(`✓ Import ${job.id} ${job.status}`))
        return
      }

      const finished = await watchImport(client, workspaceId, job)
      if (finished.status !== 'completed') {
        throw new SimApiError(
          `Import ${finished.status}${finished.error ? `: ${finished.error}` : ''}`,
          0
        )
      }
      console.log(
        chalk.green(
          `✓ Imported ${finished.rowsProcessed} rows${finished.tableId ? ` into ${finished.tableId}` : ''}`
        )
      )
    })

  // ── files download ── the response is binary, not the JSON envelope ────────
  group(program, 'files')
    .command('download <fileId>')
    .description('Download a file')
    .option('-o, --output-file <path>', 'Where to write it (defaults to the file name)')
    .option('--force', 'Overwrite the destination if it already exists')
    .action(
      async (
        fileId: string,
        options: { outputFile?: string; force?: boolean },
        command: Command
      ) => {
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

        // `wx` fails rather than truncating: a download that silently replaces an
        // existing file is unrecoverable, and the name often comes from the
        // server's content-disposition rather than anything the caller typed.
        await streamToFile(
          response.body,
          createWriteStream(target, { flags: options.force ? 'w' : 'wx' })
        )
        console.log(chalk.green(`✓ Saved ${target}`))
      }
    )

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
