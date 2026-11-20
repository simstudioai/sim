/**
 * Content-encoding for the v2 JSON answers that run to megabytes (the workflow source catalog, a
 * workspace's source). Next's own compression does not reach these answers in deployment, so a
 * route that opts in encodes its body itself: brotli when the request accepts it, else gzip, and
 * never for a request that names neither (an in-process transport sends no `Accept-Encoding`, so
 * its caller reads plain JSON). Next's compression middleware skips a response that already has a
 * `Content-Encoding`, so nothing is encoded twice.
 */
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

/** An encoding a route may answer with. */
export type BodyEncoding = 'br' | 'gzip'

/** Bodies smaller than this are sent as they are: encoding them saves too little. */
export const MIN_ENCODED_BODY_BYTES = 8 * 1024

/**
 * Brotli quality 5: within a few percent of the best ratio on JSON at a fraction of the time
 * (about 50 ms for the 9 MB block catalog, a tenth of its size).
 */
const BROTLI_QUALITY = 5

const brotliAsync = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

/**
 * The encoding an `Accept-Encoding` header prefers among the ones a route sends: `br` over
 * `gzip` unless its q-value is lower, `*` standing for either, a q-value of 0 refusing one.
 * `null` when the header is absent or accepts neither.
 */
export function preferredEncoding(acceptEncoding: string | null): BodyEncoding | null {
  if (!acceptEncoding) return null
  const weights = new Map<string, number>()
  for (const part of acceptEncoding.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    if (!name) continue
    const q = params.map((param) => /^\s*q=([0-9.]+)\s*$/.exec(param)?.[1]).find(Boolean)
    const weight = q === undefined ? 1 : Number(q)
    weights.set(name, Number.isFinite(weight) ? weight : 0)
  }
  const weight = (name: BodyEncoding) => weights.get(name) ?? weights.get('*') ?? 0
  const br = weight('br')
  const gz = weight('gzip')
  if (br <= 0 && gz <= 0) return null
  return br >= gz ? 'br' : 'gzip'
}

/** `body` encoded as `encoding`, on the thread pool so a large body never blocks the event loop. */
export function encodeBody(body: Uint8Array, encoding: BodyEncoding): Promise<Buffer> {
  return encoding === 'br'
    ? brotliAsync(body, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
        },
      })
    : gzipAsync(body)
}
