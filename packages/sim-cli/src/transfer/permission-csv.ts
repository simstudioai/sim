import { constants } from 'node:fs'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { addAbortSignal, Readable } from 'node:stream'
import { getErrorMessage } from '@sim/utils/errors'
import { CsvError, parse } from 'csv-parse'
import { embedStore } from '#sim-cli/embed-context'
import { combineSignals, SimApiError } from '#sim-cli/http/client'
import { embeddedFileKey } from '#sim-cli/transfer/local-file'

const PART_BYTES = 1024 * 1024
const PART_ROWS = 5000
const MAX_BYTES = 1024 * 1024 * 1024
const MAX_PARTS = 4096

const CSV_PROVIDERS = {
  gitlab: {
    userMapping: { header: ['user_id', 'email'], maxRows: 500_000 },
    projectPermissions: { header: ['project_path', 'user_id'], maxRows: 5_000_000 },
  },
} as const

/** Providers with a supported CSV permission format and bounded upload manifest. */
export type PermissionCsvProvider = keyof typeof CSV_PROVIDERS
type CsvField = keyof (typeof CSV_PROVIDERS)['gitlab']
interface CsvManifest {
  filename: string
  rowCount: number
  parts: number
}

async function* snapshotChunks(stream: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = stream.getReader()
  const cancel = () => {
    void reader.cancel(signal?.reason).catch(() => {})
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      signal?.throwIfAborted()
      const chunk = await reader.read()
      signal?.throwIfAborted()
      if (chunk.done) return
      yield chunk.value
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    await reader.cancel()
    reader.releaseLock()
  }
}

/** Freezes CSV records into private, bounded parts before declaring the import manifest. */
export async function stagePermissionCsvs(
  provider: PermissionCsvProvider,
  paths: Record<CsvField, string>,
  signal?: AbortSignal
) {
  const directory = await mkdtemp(join(tmpdir(), 'sim-permissions-')).catch((error: unknown) => {
    const failure = new SimApiError(`Cannot stage permission CSVs: ${getErrorMessage(error)}`, 0)
    failure.cause = error
    throw failure
  })
  const parts: { field: CsvField; path: string }[] = []
  const manifest = {} as Record<CsvField, CsvManifest>
  let totalBytes = 0
  let inputBytes = 0
  const dispose = () => rm(directory, { recursive: true, force: true })
  try {
    for (const field of ['userMapping', 'projectPermissions'] as const) {
      signal?.throwIfAborted()
      const path = paths[field]
      const filename = basename(embeddedFileKey(path))
      if (!filename.trim() || filename.length > 255 || /[\p{Cc}/\\]/u.test(filename))
        throw new SimApiError(
          'Use CSV filenames of 1–255 characters without control characters.',
          0
        )
      const embedded = embedStore.getStore()
      if (embedded && !embedded.openFile)
        throw new SimApiError('This invocation has no machine to read from', 0)
      const snapshot = await embedded?.openFile?.(embeddedFileKey(path))
      const handle = embedded
        ? undefined
        : await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
      let stream: Readable | undefined
      let snapshotStream: ReadableStream<Uint8Array> | undefined
      try {
        const before = await handle?.stat()
        if (before && !before.isFile())
          throw new SimApiError(`${field}: use a regular CSV file.`, 0)
        const size = snapshot?.size ?? before?.size
        if (
          size === undefined ||
          !Number.isSafeInteger(size) ||
          size <= 0 ||
          size > MAX_BYTES - inputBytes
        )
          throw new SimApiError('CSV files must be nonempty and total at most 1 GiB.', 0)
        inputBytes += size
        const readSignal = combineSignals(snapshot?.signal, signal)
        snapshotStream = await snapshot?.stream()
        stream = snapshotStream
          ? Readable.from(snapshotChunks(snapshotStream, readSignal))
          : handle?.createReadStream({ autoClose: false })
        if (!stream) throw new SimApiError(`Cannot read ${field}.`, 0)
        if (readSignal) addAbortSignal(readSignal, stream)
        const source = stream
        const decode = async function* () {
          const decoder = new TextDecoder('utf-8', { fatal: true })
          const decodeText = (chunk?: Uint8Array): string => {
            try {
              return decoder.decode(chunk, { stream: chunk !== undefined })
            } catch {
              throw new SimApiError(`${field}: CSV must contain valid UTF-8.`, 0)
            }
          }
          let bytes = 0
          for await (const chunk of source) {
            signal?.throwIfAborted()
            snapshot?.signal?.throwIfAborted()
            bytes += chunk.length
            if (bytes > size) throw new SimApiError(`${field}: input changed during staging.`, 0)
            for (let offset = 0; offset < chunk.length; offset += 65_536) {
              readSignal?.throwIfAborted()
              yield decodeText(chunk.subarray(offset, offset + 65_536))
            }
          }
          if (bytes !== size) throw new SimApiError(`${field}: input changed during staging.`, 0)
          yield decodeText()
        }
        const definition = CSV_PROVIDERS[provider][field]
        const header = `${definition.header.join(',')}\n`
        let content = header
        let partBytes = Buffer.byteLength(header)
        let partRows = 0
        let rowCount = 0
        const startPart = parts.length
        const save = async () => {
          if (parts.length >= MAX_PARTS || totalBytes + partBytes > MAX_BYTES)
            throw new SimApiError('Permission import exceeds 4,096 parts or 1 GiB.', 0)
          const partPath = join(directory, String(parts.length))
          await writeFile(partPath, content, { mode: 0o600, flag: 'wx' })
          parts.push({ field, path: partPath })
          totalBytes += partBytes
        }
        const parser = parse({
          bom: true,
          trim: true,
          skip_empty_lines: true,
          max_record_size: 8192,
        })
        const decoded = Readable.from(decode())
        decoded.on('error', (error) => parser.destroy(error))
        decoded.pipe(parser)
        let first = true
        try {
          const records: AsyncIterable<string[]> = parser
          for await (const row of records) {
            if (row.length !== 2 || row.some((cell) => cell.length > 4096))
              throw new SimApiError(
                `${field}: expected two CSV columns of at most 4,096 characters.`,
                0
              )
            if (first && row.every((cell, index) => cell.trim() === definition.header[index])) {
              first = false
              continue
            }
            first = false
            rowCount++
            if (rowCount > definition.maxRows)
              throw new SimApiError(`${field}: exceeds ${definition.maxRows} data records.`, 0)
            const record = `${row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(',')}\n`
            const bytes = Buffer.byteLength(record)
            if (partRows === PART_ROWS || partBytes + bytes > PART_BYTES) {
              await save()
              content = header
              partBytes = Buffer.byteLength(header)
              partRows = 0
            }
            content += record
            partBytes += bytes
            partRows++
          }
        } finally {
          decoded.destroy()
          parser.destroy()
        }
        const after = await handle?.stat()
        if (before && after && (before.size !== after.size || before.mtimeMs !== after.mtimeMs))
          throw new SimApiError(`${field}: input changed during staging. Rerun the export.`, 0)
        if (!rowCount) throw new SimApiError(`${field}: at least one data record is required.`, 0)
        await save()
        manifest[field] = { filename, rowCount, parts: parts.length - startPart }
      } catch (error) {
        if (signal?.aborted || snapshot?.signal?.aborted)
          throw new SimApiError('Permission CSV upload cancelled.', 0)
        if (error instanceof CsvError)
          throw new SimApiError(`${field}: invalid CSV quoting or record length.`, 0)
        throw error
      } finally {
        stream?.destroy()
        if (snapshotStream && !snapshotStream.locked) await snapshotStream.cancel()
        await handle?.close()
        await snapshot?.dispose()
      }
    }
    return { manifest, parts, dispose }
  } catch (error) {
    await dispose()
    if (error instanceof SimApiError) throw error
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      const failure = new SimApiError(`Cannot stage permission CSVs: ${error.message}`, 0)
      failure.cause = error
      throw failure
    }
    throw error
  }
}
