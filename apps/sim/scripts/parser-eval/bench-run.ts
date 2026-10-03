/**
 * Runs every file under `<bench-dir>/files/<ext>/` through the production
 * `parseBuffer` path and writes one JSON record per file into `<out-dir>`.
 * Run from apps/sim of the checkout under test:
 * `DATABASE_URL=postgres://x:y@localhost:1/none bun scripts/parser-eval/bench-run.ts <bench-dir> <out-dir>`
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import path from 'path'
import { getErrorMessage } from '@sim/utils/errors'
import { TextChunker } from '@/lib/chunkers/text-chunker'
import { parseBuffer } from '@/lib/file-parsers'
import { FileParserError } from '@/lib/file-parsers/errors'

const BENCH = process.argv[2]
const OUT = process.argv[3]
mkdirSync(OUT, { recursive: true })
const chunker = new TextChunker({ chunkSize: 1024, chunkOverlap: 200, minCharactersPerChunk: 100 })
const filesRoot = path.join(BENCH, 'files')
const summary: Record<string, { ok: number; error: number; typed: number }> = {}

for (const ext of readdirSync(filesRoot).sort()) {
  const dir = path.join(filesRoot, ext)
  if (!statSync(dir).isDirectory()) continue
  summary[ext] = { ok: 0, error: 0, typed: 0 }
  for (const file of readdirSync(dir).sort()) {
    const label = `${ext}__${file}`
    const bytes = readFileSync(path.join(dir, file))
    const started = performance.now()
    try {
      const result = await parseBuffer(bytes, ext, {
        pdfTextMode: ext === 'pdf' ? 'complete' : undefined,
      })
      const ms = performance.now() - started
      let chunkCount = -1
      try {
        chunkCount = (await chunker.chunk(result.content)).length
      } catch {
        chunkCount = -1
      }
      const { html, sampledData, messages, headings, links, ...metadata } = result.metadata ?? {}
      writeFileSync(
        path.join(OUT, `${label}.json`),
        JSON.stringify({
          label,
          ext,
          file,
          bytes: bytes.length,
          ms,
          ok: true,
          content: result.content,
          metadata,
          chunkCount,
        })
      )
      summary[ext].ok++
      process.stdout.write(
        `ok   ${label} ${result.content.length}ch ${ms.toFixed(0)}ms${metadata.degraded ? ' DEGRADED' : ''}${metadata.truncated ? ' TRUNCATED' : ''}\n`
      )
    } catch (error) {
      const ms = performance.now() - started
      const typed = error instanceof FileParserError
      writeFileSync(
        path.join(OUT, `${label}.json`),
        JSON.stringify({
          label,
          ext,
          file,
          bytes: bytes.length,
          ms,
          ok: false,
          typedError: typed,
          errorCode: typed ? error.code : undefined,
          errorName: error instanceof Error ? error.name : undefined,
          error: getErrorMessage(error, 'Unknown error').slice(0, 300),
        })
      )
      summary[ext].error++
      if (typed) summary[ext].typed++
      process.stdout.write(
        `FAIL ${label} ${typed ? `typed:${error.code}` : `UNTYPED:${error instanceof Error ? error.name : 'unknown'}`} ${getErrorMessage(error, 'Unknown error').slice(0, 80)}\n`
      )
    }
  }
}
writeFileSync(path.join(OUT, '_summary.json'), JSON.stringify(summary, null, 1))
console.log(JSON.stringify(summary))
