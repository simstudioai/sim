/**
 * The parse worker is a cross-process boundary type-check cannot see: results
 * and errors are structured-cloned, and the bundle is built by a separate
 * script. Failure modes this file guards, each one test:
 *
 * 1. Worker output diverges from in-process parsing (preview, complete).
 * 2. A typed parser error loses its class, `code`, or message crossing back.
 * 3. A missing bundle breaks parsing instead of falling back in-process.
 * 4. An unloadable bundle (throws at load, or the Worker constructor itself
 *    throws) breaks parsing or strands queued jobs instead of falling back.
 * 5. A worker crash mid-parse loses the job instead of re-running it in-process.
 * 6. An abort during a worker parse hangs or leaves the worker occupying its slot.
 * 7. An abort while queued still dispatches the job.
 * 8. Dispatch detaches the caller's buffer (transfer of caller-owned memory).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import type { FileParseOptions, FileParseResult } from '@/lib/file-parsers/types'
import { XlsxParser } from '@/lib/file-parsers/xlsx-parser'
import { resolveXlsxWorkerPath, XlsxWorkerPool } from '@/lib/file-parsers/xlsx-worker-pool'

const APP_ROOT = path.resolve(__dirname, '..', '..')
const parser = new XlsxParser()
let builtWorkerPath: string
let fakeWorkerDir: string

function workbook(): Buffer {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['Name', 'Amount', 'When'],
      ['alpha', 1250.5, new Date(Date.UTC(2024, 0, 2))],
      ['beta\twith tab', 0.2, 'text'],
    ]),
    'First'
  )
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['only'], ['cells']]), 'Second')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer
}

/** A ZIP declaring more central-directory records than the archive guard allows. */
function oversizedCentralDirectory(): Buffer {
  const entryCount = 10_001
  const centralDirectory = Buffer.alloc(46 * entryCount)
  for (let index = 0; index < entryCount; index++) {
    centralDirectory.writeUInt32LE(0x02014b50, index * 46)
  }
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entryCount, 8)
  eocd.writeUInt16LE(entryCount, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  return Buffer.concat([centralDirectory, eocd])
}

function writeFakeWorker(name: string, source: string): string {
  const file = path.join(fakeWorkerDir, name)
  writeFileSync(file, source)
  return file
}

type Outcome =
  | { ok: true; result: FileParseResult }
  | { ok: false; error: { ctor: string; name: string; code: unknown; message: string } }

async function settle(promise: Promise<FileParseResult>): Promise<Outcome> {
  try {
    return { ok: true, result: await promise }
  } catch (error) {
    const e = error as Error & { code?: unknown }
    return {
      ok: false,
      error: { ctor: e.constructor.name, name: e.name, code: e.code, message: e.message },
    }
  }
}

function inProcess(buffer: Buffer, options: FileParseOptions = {}) {
  return () => parser.parseBuffer(buffer, options)
}

beforeAll(() => {
  execFileSync('bun', ['run', 'build:xlsx-worker'], { cwd: APP_ROOT, stdio: 'pipe' })
  const resolved = resolveXlsxWorkerPath()
  if (!resolved) throw new Error('build:xlsx-worker did not produce a resolvable bundle')
  builtWorkerPath = resolved
  fakeWorkerDir = mkdtempSync(path.join(tmpdir(), 'xlsx-worker-pool-'))
}, 60_000)

describe('XlsxWorkerPool against the built bundle', () => {
  const cases: Array<{ name: string; buffer: () => Buffer; options: FileParseOptions }> = [
    { name: 'preview workbook', buffer: workbook, options: {} },
    { name: 'complete workbook', buffer: workbook, options: { contentMode: 'complete' } },
    {
      name: 'complete text budget exceeded',
      buffer: workbook,
      options: { contentMode: 'complete', maxTextBytes: 8 },
    },
    { name: 'archive guard rejection', buffer: oversizedCentralDirectory, options: {} },
    {
      name: 'corrupt ZIP payload',
      buffer: () => Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(256, 7)]),
      options: {},
    },
  ]

  it.each(cases)('matches in-process parsing for $name', async ({ buffer, options }) => {
    const expected = await settle(parser.parseBuffer(buffer(), options))
    const pool = new XlsxWorkerPool({ workerPath: builtWorkerPath, size: 1 })
    const input = buffer()

    const actual = await settle(
      pool.parse(input, options, () => Promise.reject(new Error('fell back')))
    )

    expect(actual).toEqual(expected)
  })

  it('leaves the caller buffer intact after dispatch', async () => {
    const input = workbook()
    const snapshot = Buffer.from(input)
    const pool = new XlsxWorkerPool({ workerPath: builtWorkerPath, size: 1 })

    await pool.parse(input, {}, () => Promise.reject(new Error('fell back')))

    expect(input.byteLength).toBe(snapshot.byteLength)
    expect(input.equals(snapshot)).toBe(true)
  })
})

describe('XlsxWorkerPool fallback', () => {
  it('parses in-process when no bundle is available', async () => {
    const input = workbook()
    const expected = await parser.parseBuffer(input)
    const pool = new XlsxWorkerPool({ workerPath: null, size: 1 })

    await expect(pool.parse(input, {}, inProcess(input))).resolves.toEqual(expected)
  })

  it('parses in-process when the bundle throws while loading', async () => {
    const input = workbook()
    const expected = await parser.parseBuffer(input)
    const workerPath = writeFakeWorker('throws.mjs', "throw new Error('broken bundle')\n")
    const pool = new XlsxWorkerPool({ workerPath, size: 1 })

    await expect(pool.parse(input, {}, inProcess(input))).resolves.toEqual(expected)
    await expect(pool.parse(input, {}, inProcess(input))).resolves.toEqual(expected)
  })

  it('parses every queued job in-process when the Worker constructor throws', async () => {
    const input = workbook()
    const expected = await parser.parseBuffer(input)
    const pool = new XlsxWorkerPool({ workerPath: 'not-a-resolvable-worker-path.mjs', size: 1 })

    const results = await Promise.all([
      pool.parse(input, {}, inProcess(input)),
      pool.parse(input, {}, inProcess(input)),
    ])

    expect(results).toEqual([expected, expected])
  })

  it('re-runs a job in-process when the worker dies mid-parse', async () => {
    const input = workbook()
    const expected = await parser.parseBuffer(input)
    const workerPath = writeFakeWorker(
      'crashes.mjs',
      [
        "import { parentPort } from 'node:worker_threads'",
        "parentPort.on('message', () => process.exit(3))",
        "parentPort.postMessage({ type: 'ready' })",
      ].join('\n')
    )
    const pool = new XlsxWorkerPool({ workerPath, size: 1 })

    await expect(pool.parse(input, {}, inProcess(input))).resolves.toEqual(expected)
  })
})

describe('XlsxWorkerPool cancellation', () => {
  /** Spins forever on `maxTextBytes: 1`, otherwise answers immediately. */
  const spinningWorkerSource = [
    "import { parentPort } from 'node:worker_threads'",
    "parentPort.on('message', (request) => {",
    '  if (request.options.maxTextBytes === 1) for (;;) {}',
    "  parentPort.postMessage({ type: 'result', result: { content: 'answered' } })",
    '})',
    "parentPort.postMessage({ type: 'ready' })",
  ].join('\n')

  it('rejects with the abort reason and frees the slot held by a spinning worker', async () => {
    const workerPath = writeFakeWorker('spins.mjs', spinningWorkerSource)
    const pool = new XlsxWorkerPool({ workerPath, size: 1 })
    const controller = new AbortController()
    const reason = new Error('deadline')
    const fallback = () => Promise.reject(new Error('fell back'))

    const spinning = pool.parse(
      workbook(),
      { signal: controller.signal, maxTextBytes: 1 },
      fallback
    )
    const queued = pool.parse(workbook(), {}, fallback)
    setTimeout(() => controller.abort(reason), 50)

    await expect(spinning).rejects.toBe(reason)
    await expect(queued).resolves.toEqual({ content: 'answered' })
  })

  it('rejects a queued job on abort while the worker is busy', async () => {
    const workerPath = writeFakeWorker('spins-queue.mjs', spinningWorkerSource)
    const pool = new XlsxWorkerPool({ workerPath, size: 1 })
    const blocker = new AbortController()
    const queuedController = new AbortController()
    const reason = new Error('caller gave up')
    const fallback = () => Promise.reject(new Error('fell back'))

    const spinning = pool.parse(workbook(), { signal: blocker.signal, maxTextBytes: 1 }, fallback)
    const queued = pool.parse(workbook(), { signal: queuedController.signal }, fallback)
    queuedController.abort(reason)

    await expect(queued).rejects.toBe(reason)
    blocker.abort(new Error('cleanup'))
    await expect(spinning).rejects.toThrow('cleanup')
  })
})
