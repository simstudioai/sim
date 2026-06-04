import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import busboy from 'busboy'

/**
 * Streaming multipart/form-data reader built on `busboy`.
 *
 * Unlike `request.formData()` (undici), this never buffers the whole request
 * body in memory and does not depend on a correct `content-length`/boundary —
 * it parses the request as it streams off the socket. The single file part is
 * surfaced as an un-drained Node {@link Readable} so the caller can run auth /
 * create-table work BEFORE consuming the (potentially huge) file bytes.
 *
 * @see readMultipart
 */

/** Error codes surfaced by {@link readMultipart} and the returned file stream. */
export type MultipartErrorCode =
  | 'NOT_MULTIPART'
  | 'NO_BODY'
  | 'FILE_TOO_LARGE'
  | 'FIELD_AFTER_FILE'
  | 'NO_FILE'
  | 'PARSE_ERROR'

/**
 * Error thrown by {@link readMultipart} (for pre-file failures) or emitted on
 * the returned file stream (for failures during consumption, e.g.
 * `FILE_TOO_LARGE`). Callers map `code` to an HTTP status.
 */
export class MultipartError extends Error {
  readonly code: MultipartErrorCode

  constructor(code: MultipartErrorCode, message: string) {
    super(message)
    this.name = 'MultipartError'
    this.code = code
  }
}

export function isMultipartError(error: unknown): error is MultipartError {
  return error instanceof MultipartError
}

export interface MultipartFilePart {
  /** The multipart field name that carried the file (expected: `file`). */
  fieldName: string
  filename: string
  mimeType: string
  /**
   * The file bytes. The caller MUST fully consume or `destroy()` this stream
   * (use a `finally`) or the request will hang. On overflow of `maxFileBytes`
   * the stream is destroyed with a {@link MultipartError} (`FILE_TOO_LARGE`).
   */
  stream: Readable
}

export interface ParsedMultipart {
  /** Text fields that arrived before the file part, keyed by field name. */
  fields: Record<string, string>
  /** The single file part, or `null` if the body had no file part. */
  file: MultipartFilePart | null
}

export interface ReadMultipartOptions {
  /** Per-file byte cap. Overflow destroys the file stream with `FILE_TOO_LARGE`. */
  maxFileBytes: number
  /**
   * Field names that must arrive before the file part. If the file part is
   * seen while any are still missing, the parse rejects with `FIELD_AFTER_FILE`.
   */
  requiredFieldsBeforeFile?: string[]
  /** Field name expected to carry the file. Defaults to `file`. */
  fileFieldName?: string
  /** Abort signal — cancels parsing and destroys the underlying stream. */
  signal?: AbortSignal
}

interface MultipartRequest {
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}

/**
 * Parse a `multipart/form-data` request as a stream. Resolves as soon as the
 * file-part header is seen (text fields collected up to that point are in
 * `fields`); the file bytes are NOT yet consumed — the caller drives
 * `result.file.stream`.
 *
 * Pre-file failures reject the returned promise; failures that happen while the
 * file streams (size limit, mid-body parse errors, abort) are surfaced as an
 * error on `result.file.stream`.
 */
export function readMultipart(
  request: MultipartRequest,
  options: ReadMultipartOptions
): Promise<ParsedMultipart> {
  const { maxFileBytes, requiredFieldsBeforeFile = [], fileFieldName = 'file', signal } = options

  return new Promise<ParsedMultipart>((resolve, reject) => {
    const contentType = request.headers.get('content-type')
    if (!contentType || !contentType.toLowerCase().includes('multipart/form-data')) {
      reject(new MultipartError('NOT_MULTIPART', 'Expected multipart/form-data request'))
      return
    }
    if (!request.body) {
      reject(new MultipartError('NO_BODY', 'Request has no body'))
      return
    }

    let bb: busboy.Busboy
    try {
      bb = busboy({
        headers: { 'content-type': contentType },
        limits: { fileSize: maxFileBytes, files: 1 },
      })
    } catch (err) {
      reject(
        new MultipartError(
          'NOT_MULTIPART',
          err instanceof Error ? err.message : 'Invalid multipart request'
        )
      )
      return
    }

    // double-cast-allowed: the web ReadableStream on request.body isn't structurally assignable to the Node type Readable.fromWeb expects
    const nodeStream = Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>)
    const fields: Record<string, string> = {}
    let settled = false
    let fileSeen = false

    const onAbort = () => {
      const reason = signal?.reason instanceof Error ? signal.reason : new Error('Aborted')
      nodeStream.destroy(reason)
      bb.destroy()
      if (!settled) {
        settled = true
        reject(reason)
      }
    }

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
    }

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    if (signal?.aborted) {
      // `destroy()` with no reason emits 'close', not an unhandled 'error'.
      nodeStream.destroy()
      settled = true
      reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    bb.on('field', (name, value) => {
      fields[name] = value
    })

    bb.on('file', (name, stream, info) => {
      if (settled || fileSeen) {
        stream.resume()
        return
      }
      fileSeen = true

      if (name !== fileFieldName) {
        stream.resume()
        nodeStream.destroy()
        settle(() =>
          reject(
            new MultipartError('NO_FILE', `Expected file field "${fileFieldName}", got "${name}"`)
          )
        )
        return
      }

      const missing = requiredFieldsBeforeFile.filter((field) => !(field in fields))
      if (missing.length > 0) {
        stream.resume()
        nodeStream.destroy()
        settle(() =>
          reject(
            new MultipartError(
              'FIELD_AFTER_FILE',
              `Field(s) must precede the file in the request body: ${missing.join(', ')}`
            )
          )
        )
        return
      }

      stream.once('limit', () => {
        stream.destroy(
          new MultipartError('FILE_TOO_LARGE', `File exceeds maximum size of ${maxFileBytes} bytes`)
        )
      })

      settle(() => {
        // settle() detached the pre-file abort handler. Re-arm one scoped to the file stream so a
        // client disconnect mid-upload tears it down — otherwise the caller's consume loop hangs
        // until maxDuration. Detach when the stream closes so it can't fire afterward.
        if (signal) {
          const onStreamAbort = () => {
            const reason = signal.reason instanceof Error ? signal.reason : new Error('Aborted')
            stream.destroy(reason)
            nodeStream.destroy(reason)
            bb.destroy()
          }
          if (signal.aborted) onStreamAbort()
          else {
            signal.addEventListener('abort', onStreamAbort, { once: true })
            stream.once('close', () => signal.removeEventListener('abort', onStreamAbort))
          }
        }
        resolve({
          fields,
          file: { fieldName: name, filename: info.filename, mimeType: info.mimeType, stream },
        })
      })
    })

    bb.on('error', (err) => {
      const message = err instanceof Error ? err.message : 'Failed to parse multipart body'
      settle(() => reject(new MultipartError('PARSE_ERROR', message)))
    })

    bb.on('close', () => {
      if (!fileSeen) {
        settle(() => reject(new MultipartError('NO_FILE', 'No file part in multipart body')))
      }
    })

    nodeStream.on('error', (err) => {
      settle(() =>
        reject(
          err instanceof MultipartError
            ? err
            : new MultipartError(
                'PARSE_ERROR',
                err instanceof Error ? err.message : 'Failed to read request body'
              )
        )
      )
    })

    nodeStream.pipe(bb)
  })
}
