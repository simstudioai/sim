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

interface FileUpload {
  id: string
  size: number
  partSize: number
  partCount: number
  uploadToken: string
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
 * mid-flight has to abort the whole upload anyway, and a sequential loop makes
 * "which part failed" unambiguous.
 */
async function uploadParts(
  client: SimClient,
  workspaceId: string,
  upload: FileUpload,
  blob: Blob
): Promise<Array<{ partNumber: number; etag?: string }>> {
  const completed: Array<{ partNumber: number; etag?: string }> = []

  for (let first = 1; first <= upload.partCount; first += PART_URL_BATCH) {
    const partNumbers = []
    for (let n = first; n < first + PART_URL_BATCH && n <= upload.partCount; n++) {
      partNumbers.push(n)
    }

    const signed = await client.request<{ data: { parts: UploadPartUrl[] } }>(
      `/api/v2/files/uploads/${encodeURIComponent(upload.id)}/parts`,
      {
        method: 'POST',
        query: { workspaceId },
        headers: { 'upload-token': upload.uploadToken },
        body: { partNumbers },
      }
    )

    for (const part of signed.data.parts) {
      const start = (part.partNumber - 1) * upload.partSize
      // `Blob.slice` is a view over the file on disk, so only the part being
      // sent is ever read — the point of not buffering the upload.
      const chunk = blob.slice(start, Math.min(start + upload.partSize, upload.size))

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

        let size: number
        try {
          const stats = await stat(path)
          if (stats.isDirectory()) throw new SimApiError(`${path} is a directory`, 0)
          size = stats.size
        } catch (error) {
          if (error instanceof SimApiError) throw error
          throw new SimApiError(`Cannot read ${path}: ${(error as Error).message}`, 0)
        }

        // The server sizes its own parts, but it cannot reject an empty file any
        // more cheaply than we can: a zero-byte upload has no parts to send.
        if (size === 0) throw new SimApiError(`${path} is empty`, 0)

        const name = options.name ?? basename(path)

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

        // Any failure past this point leaves an upload holding storage, so the
        // rest runs under an abort that the server also uses to release it.
        try {
          const blob = await openAsBlob(path)
          const parts = await uploadParts(client, workspaceId, upload, blob)

          const completed = await client.request<{ data: FileUpload }>(
            `/api/v2/files/uploads/${encodeURIComponent(upload.id)}/complete`,
            {
              method: 'POST',
              query: { workspaceId },
              headers: { 'upload-token': upload.uploadToken },
              body: { parts },
            }
          )
          console.log(
            chalk.green(`✓ Uploaded ${name} (${completed.data.file?.id ?? completed.data.id})`)
          )
        } catch (error) {
          await client
            .request(`/api/v2/files/uploads/${encodeURIComponent(upload.id)}`, {
              method: 'DELETE',
              query: { workspaceId },
              headers: { 'upload-token': upload.uploadToken },
            })
            // The original failure is what the caller needs; a failed cleanup
            // must not replace it with a message about the cleanup.
            .catch(() => undefined)
          throw error
        }
      }
    )

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
