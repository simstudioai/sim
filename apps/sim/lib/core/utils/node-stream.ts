import type { Readable } from 'node:stream'

/**
 * Bridges a Node `Readable` into a WHATWG `ReadableStream` suitable for a `Response`
 * body. Node's built-in `Readable.toWeb` is NOT used: its adapter throws an unhandled
 * `ERR_INVALID_STATE` ("Controller is already closed") when the web stream is cancelled
 * while the Node stream is still flowing — which happens whenever a consumer aborts a
 * live body (a redirect hop cancelling the previous response, a browser cancelling a
 * download mid-transfer). This bridge instead swallows a late enqueue after close and
 * destroys the source on cancel, so cancelling a live body frees its socket cleanly.
 * Source errors — a size-limit overrun, a storage read failing mid-archive — surface as
 * the source's `error` event and reject the read.
 */
export function nodeReadableToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  let settled = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => {
        try {
          // Copy, not a view: the producer may recycle the pooled buffer backing `chunk`
          // after this handler returns, which would corrupt a chunk still queued for a
          // slow consumer. `new Uint8Array(chunk)` allocates a fresh backing buffer.
          controller.enqueue(new Uint8Array(chunk))
        } catch {
          // Controller already closed (consumer cancelled) — stop the source, drop the chunk.
          nodeStream.destroy()
          return
        }
        if ((controller.desiredSize ?? 1) <= 0) nodeStream.pause()
      })
      nodeStream.once('end', () => {
        settled = true
        try {
          controller.close()
        } catch {}
      })
      nodeStream.once('error', (err) => {
        settled = true
        try {
          controller.error(err)
        } catch {}
      })
      // An abort or upstream reset can `destroy()` the source with no `error` event;
      // without this the reader would hang forever. `close` fires after every terminal
      // path, so only act when `end`/`error` didn't already settle the stream.
      nodeStream.once('close', () => {
        if (settled) return
        settled = true
        try {
          controller.error(new Error('Stream closed before completing'))
        } catch {}
      })
      // Start paused so nothing buffers before the consumer pulls (backpressure).
      nodeStream.pause()
    },
    pull() {
      nodeStream.resume()
    },
    cancel(reason) {
      nodeStream.destroy(reason instanceof Error ? reason : undefined)
    },
  })
}
