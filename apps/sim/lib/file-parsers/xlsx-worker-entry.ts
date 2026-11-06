/**
 * Worker-thread entry for spreadsheet parsing, bundled to
 * `apps/sim/dist/xlsx-worker.mjs` by `bun run build:xlsx-worker` and
 * spawned by `xlsx-worker-pool.ts`. It runs the same {@link XlsxParser} the
 * main thread falls back to, so the two paths cannot drift.
 */
import { parentPort } from 'node:worker_threads'
import { XlsxParser } from '@/lib/file-parsers/xlsx-parser'
import {
  serializeXlsxWorkerError,
  type XlsxWorkerMessage,
  type XlsxWorkerParseRequest,
} from '@/lib/file-parsers/xlsx-worker-protocol'

const port = parentPort
if (!port) throw new Error('xlsx-worker-entry must run inside a worker thread')

const parser = new XlsxParser()

function reply(message: XlsxWorkerMessage) {
  port?.postMessage(message)
}

port.on('message', async (request: XlsxWorkerParseRequest) => {
  try {
    const buffer = Buffer.from(
      request.data.buffer,
      request.data.byteOffset,
      request.data.byteLength
    )
    reply({ type: 'result', result: await parser.parseBuffer(buffer, request.options) })
  } catch (error) {
    reply({ type: 'error', error: serializeXlsxWorkerError(error) })
  }
})

reply({ type: 'ready' })
