/**
 * Runs every corpus file through the production parser entry point exactly as
 * knowledge-base ingestion does, then runs the default chunker on the output.
 * Run from apps/sim: `bun scripts/parser-eval/run-parsers.ts <corpus-dir>`
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { TextChunker } from '@/lib/chunkers/text-chunker'
import { parseBuffer } from '@/lib/file-parsers'
import { FileParserError } from '@/lib/file-parsers/errors'

const OUT = process.argv[2]
const OUTPUTS = path.join(OUT, 'outputs')
mkdirSync(OUTPUTS, { recursive: true })

interface Entry {
  file: string
  dir: string
  doc: string
  format: string
  tier: 'A' | 'B'
  absence: string[]
  variant?: string
  firstSheetOnly?: boolean
}

const entries: Entry[] = []
for (const m of ['manifest-a.json', 'manifest-sheets.json']) {
  const p = path.join(OUT, m)
  if (existsSync(p))
    for (const e of JSON.parse(readFileSync(p, 'utf8'))) entries.push({ ...e, dir: 'files' })
}
const realDir = path.join(OUT, 'real')
if (existsSync(realDir)) {
  for (const file of readdirSync(realDir).sort()) {
    const ext = path.extname(file).slice(1).toLowerCase()
    if (!ext) continue
    entries.push({
      file,
      dir: 'real',
      doc: file.replace(/\.[^.]+$/, ''),
      format: ext,
      tier: 'B',
      absence: [],
    })
  }
}

const fixture = (name: string) => readFileSync(path.join(OUT, 'files', name))

/** Robustness cases: each must surface a typed error rather than content. */
const robustness: Array<{ name: string; ext: string; bytes: Buffer }> = [
  { name: 'empty.docx', ext: 'docx', bytes: Buffer.alloc(0) },
  { name: 'truncated-docx', ext: 'docx', bytes: fixture('memo.docx').subarray(0, 700) },
  { name: 'truncated-pdf', ext: 'pdf', bytes: fixture('memo.pdf').subarray(0, 3000) },
  { name: 'pdf-bytes-labelled-docx', ext: 'docx', bytes: fixture('memo.pdf') },
  { name: 'docx-bytes-labelled-pdf', ext: 'pdf', bytes: fixture('memo.docx') },
  {
    name: 'png-labelled-doc',
    ext: 'doc',
    bytes: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7919) % 256)),
    ]),
  },
  {
    name: 'random-bytes-labelled-ppt',
    ext: 'ppt',
    bytes: Buffer.from(Array.from({ length: 50000 }, (_, i) => (i * 104729 + 17) % 256)),
  },
  {
    name: 'latin1-txt',
    ext: 'txt',
    bytes: Buffer.from('Caf\xe9 r\xe9sum\xe9 na\xefve \xa3 42', 'latin1'),
  },
  {
    name: 'utf16-txt',
    ext: 'txt',
    bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hello UTF-16 world', 'utf16le')]),
  },
  { name: 'html-labelled-txt', ext: 'txt', bytes: fixture('memo.html') },
  { name: 'docx-labelled-xlsx', ext: 'xlsx', bytes: fixture('memo.docx') },
  { name: 'csv-labelled-xlsx', ext: 'xlsx', bytes: fixture('sheet-employees.csv') },
  { name: 'docx-labelled-doc', ext: 'doc', bytes: fixture('memo.docx') },
  { name: 'pptx-labelled-ppt', ext: 'ppt', bytes: fixture('memo.pptx') },
]

const results: unknown[] = []
const chunker = new TextChunker({ chunkSize: 1024, chunkOverlap: 200, minCharactersPerChunk: 100 })

async function runOne(label: string, ext: string, bytes: Buffer, meta: Record<string, unknown>) {
  const started = performance.now()
  try {
    const result = await parseBuffer(bytes, ext, {
      pdfTextMode: ext === 'pdf' ? 'complete' : undefined,
    })
    const ms = performance.now() - started
    let chunks: string[] = []
    try {
      chunks = (await chunker.chunk(result.content)).map((c) => c.text)
    } catch (e) {
      chunks = [`CHUNK_ERROR ${String(e)}`]
    }
    const { html, sampledData, messages, ...metadata } = result.metadata ?? {}
    const record = {
      label,
      ext,
      bytes: bytes.length,
      ms,
      ok: true,
      content: result.content,
      metadata: { ...metadata, messageCount: Array.isArray(messages) ? messages.length : 0 },
      chunks,
      ...meta,
    }
    writeFileSync(path.join(OUTPUTS, `${label}.json`), JSON.stringify(record, null, 1))
    results.push({
      ...record,
      content: undefined,
      chunks: undefined,
      contentLength: result.content.length,
      chunkCount: chunks.length,
    })
    process.stdout.write(
      `ok   ${label} ${result.content.length}ch ${ms.toFixed(0)}ms ${metadata.degraded ? 'DEGRADED' : ''} ${metadata.truncated ? 'TRUNCATED' : ''}\n`
    )
  } catch (error) {
    const ms = performance.now() - started
    const typed = error instanceof FileParserError
    const record = {
      label,
      ext,
      bytes: bytes.length,
      ms,
      ok: false,
      typedError: typed,
      errorCode: typed ? (error as FileParserError).code : undefined,
      error: String((error as Error)?.message ?? error),
      ...meta,
    }
    writeFileSync(path.join(OUTPUTS, `${label}.json`), JSON.stringify(record, null, 1))
    results.push(record)
    process.stdout.write(
      `FAIL ${label} ${typed ? `typed:${record.errorCode}` : 'UNTYPED'} ${record.error.slice(0, 100)}\n`
    )
  }
}

for (const e of entries) {
  await runOne(e.file, e.format, readFileSync(path.join(OUT, e.dir, e.file)), {
    doc: e.doc,
    format: e.format,
    tier: e.tier,
    absence: e.absence,
    variant: e.variant,
    firstSheetOnly: e.firstSheetOnly,
  })
}
for (const r of robustness) await runOne(`robust__${r.name}`, r.ext, r.bytes, { tier: 'R' })

writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1))
console.log(`\n${entries.length} corpus files + ${robustness.length} robustness cases`)
