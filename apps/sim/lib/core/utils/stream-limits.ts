import { toError } from '@sim/utils/errors'
import { containsNulCharacter } from '@sim/utils/string'

export const DEFAULT_MAX_ERROR_BODY_BYTES = 64 * 1024

/**
 * Slack for multipart boundary/header overhead on top of the intended file
 * size limit, so legitimate uploads near the limit aren't rejected purely
 * for encoding overhead.
 */
export const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024

export interface PayloadSizeLimitContext {
  label: string
  maxBytes: number
  observedBytes?: number
}

export class PayloadSizeLimitError extends Error {
  readonly label: string
  readonly maxBytes: number
  readonly observedBytes?: number

  constructor({ label, maxBytes, observedBytes }: PayloadSizeLimitContext) {
    super(
      observedBytes === undefined
        ? `${label} exceeds maximum size of ${maxBytes} bytes`
        : `${label} exceeds maximum size of ${maxBytes} bytes (${observedBytes} bytes received)`
    )
    this.name = 'PayloadSizeLimitError'
    this.label = label
    this.maxBytes = maxBytes
    this.observedBytes = observedBytes
  }
}

export function isPayloadSizeLimitError(error: unknown): error is PayloadSizeLimitError {
  return error instanceof PayloadSizeLimitError
}

export function assertKnownSizeWithinLimit(size: number, maxBytes: number, label: string): void {
  if (Number.isFinite(size) && size > maxBytes) {
    throw new PayloadSizeLimitError({ label, maxBytes, observedBytes: size })
  }
}

function getContentLength(
  headers: { get(name: string): string | null } | undefined
): number | null {
  const rawLength = headers?.get('content-length')
  if (!rawLength) return null
  const parsed = Number.parseInt(rawLength, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function assertContentLengthWithinLimit(
  headers: { get(name: string): string | null } | undefined,
  maxBytes: number,
  label: string
): void {
  const contentLength = getContentLength(headers)
  if (contentLength !== null) {
    assertKnownSizeWithinLimit(contentLength, maxBytes, label)
  }
}

export interface ReadFormDataWithLimitRequest {
  url: string
  method: string
  headers?: Headers
  body?: ReadableStream<Uint8Array> | null
  formData: () => Promise<FormData>
}

/**
 * A multipart field whose text a downstream store cannot represent. Distinct
 * from {@link PayloadSizeLimitError} so a surface can project it as its own 400
 * with the reason intact, and never as a size failure.
 */
export class MultipartFieldValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MultipartFieldValidationError'
  }
}

export function isMultipartFieldValidationError(
  error: unknown
): error is MultipartFieldValidationError {
  return error instanceof MultipartFieldValidationError
}

/**
 * Multipart is the second request boundary, and `parseRequest`'s NUL scan
 * cannot reach it: a multipart route declares no body contract, so its fields
 * never pass through contract validation at all. A NUL in a `filename` therefore
 * reached the knowledge-document insert directly, and because the storage key is
 * sanitized while `original_name`/`display_name` are not, the object landed in
 * object storage *before* the insert threw — a 500 plus an orphan.
 *
 * So the scan belongs on the shared multipart reader, which is what every
 * multipart route already funnels through, rather than on each route's own
 * field extraction. Rejecting here also runs before the caller has a `File` to
 * hand to a storage write, which is what removes the orphan rather than
 * cleaning it up afterwards.
 *
 * Only field names, text values, and file names are scanned. A `File`'s bytes
 * are deliberately not: a zero *byte* in binary content is legitimate, and the
 * bytes never become a text column.
 */
function assertMultipartFieldsAreStorable(formData: FormData): void {
  for (const [name, value] of formData.entries()) {
    if (containsNulCharacter(name)) {
      throw new MultipartFieldValidationError(
        'Multipart field names cannot contain a NUL character (U+0000)'
      )
    }
    if (typeof value === 'string') {
      if (containsNulCharacter(value)) {
        throw new MultipartFieldValidationError(
          `Multipart field "${name}" cannot contain a NUL character (U+0000)`
        )
      }
      continue
    }
    if (containsNulCharacter(value.name)) {
      throw new MultipartFieldValidationError(
        `Multipart file name for field "${name}" cannot contain a NUL character (U+0000)`
      )
    }
  }
}

export async function readFormDataWithLimit(
  request: ReadFormDataWithLimitRequest,
  options: { maxBytes: number; label: string }
): Promise<FormData> {
  assertContentLengthWithinLimit(request.headers, options.maxBytes, options.label)

  if (request.headers?.get('content-length') || !request.body) {
    const formData = await request.formData()
    assertMultipartFieldsAreStorable(formData)
    return formData
  }

  const body = await readStreamToBufferWithLimit(request.body, options)
  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: new Uint8Array(body),
  })
  const formData = await boundedRequest.formData()
  assertMultipartFieldsAreStorable(formData)
  return formData
}

export interface ReadStreamWithLimitOptions {
  maxBytes: number
  label: string
  signal?: AbortSignal
  onChunk?: (chunk: Uint8Array, totalBytes: number) => void | Promise<void>
}

export async function readStreamToBufferWithLimit(
  stream: ReadableStream<Uint8Array> | null | undefined,
  options: ReadStreamWithLimitOptions
): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0)

  const reader = stream.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0
  const abortFromSignal = () => {
    void reader.cancel(options.signal?.reason).catch(() => {})
  }

  try {
    if (options.signal?.aborted) {
      await reader.cancel(options.signal.reason).catch(() => {})
      throw toError(options.signal.reason ?? new Error('Aborted'))
    }
    options.signal?.addEventListener('abort', abortFromSignal, { once: true })

    while (true) {
      if (options.signal?.aborted) {
        await reader.cancel(options.signal.reason).catch(() => {})
        throw toError(options.signal.reason ?? new Error('Aborted'))
      }

      const { done, value } = await reader.read()
      if (options.signal?.aborted) {
        throw toError(options.signal.reason ?? new Error('Aborted'))
      }
      if (done) break
      if (!value) continue

      totalBytes += value.byteLength
      if (totalBytes > options.maxBytes) {
        await reader.cancel().catch(() => {})
        throw new PayloadSizeLimitError({
          label: options.label,
          maxBytes: options.maxBytes,
          observedBytes: totalBytes,
        })
      }

      await options.onChunk?.(value, totalBytes)
      chunks.push(Buffer.from(value))
    }
  } finally {
    options.signal?.removeEventListener('abort', abortFromSignal)
    reader.releaseLock()
  }

  return Buffer.concat(chunks, totalBytes)
}

export async function readNodeStreamToBufferWithLimit(
  stream: NodeJS.ReadableStream | null | undefined,
  options: ReadStreamWithLimitOptions
): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0)

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const cleanup = () => {
      stream.off('data', onData)
      stream.off('end', onEnd)
      stream.off('error', onError)
      options.signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      if ('destroy' in stream && typeof stream.destroy === 'function') {
        stream.destroy(toError(options.signal?.reason ?? new Error('Aborted')))
      }
      finish(() => reject(toError(options.signal?.reason ?? new Error('Aborted'))))
    }

    const onData = (chunk: Buffer | Uint8Array | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.byteLength

      if (totalBytes > options.maxBytes) {
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          stream.destroy()
        }
        finish(() =>
          reject(
            new PayloadSizeLimitError({
              label: options.label,
              maxBytes: options.maxBytes,
              observedBytes: totalBytes,
            })
          )
        )
        return
      }

      void options.onChunk?.(buffer, totalBytes)
      chunks.push(buffer)
    }

    const onEnd = () => {
      finish(() => resolve(Buffer.concat(chunks, totalBytes)))
    }

    const onError = (error: unknown) => {
      finish(() => reject(error))
    }

    if (options.signal?.aborted) {
      onAbort()
      return
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })
    stream.on('data', onData)
    stream.on('end', onEnd)
    stream.on('error', onError)
  })
}

export interface ReadResponseWithLimitOptions extends ReadStreamWithLimitOptions {
  headers?: { get(name: string): string | null }
  preferTextFallback?: boolean
  allowNoBodyFallback?: boolean
}

export async function readResponseToBufferWithLimit(
  response: {
    headers?: { get(name: string): string | null }
    body?: ReadableStream<Uint8Array> | null
    arrayBuffer?: () => Promise<ArrayBuffer>
    text?: () => Promise<string>
  },
  options: ReadResponseWithLimitOptions
): Promise<Buffer> {
  const contentLength = getContentLength(response.headers ?? options.headers)
  try {
    if (contentLength !== null) {
      assertKnownSizeWithinLimit(contentLength, options.maxBytes, options.label)
    }
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      await response.body?.cancel(error).catch(() => {})
    }
    throw error
  }
  if (
    !options.allowNoBodyFallback &&
    !options.preferTextFallback &&
    !response.body &&
    contentLength === null &&
    (response.arrayBuffer || response.text)
  ) {
    throw new PayloadSizeLimitError({
      label: options.label,
      maxBytes: options.maxBytes,
    })
  }
  if (!response.body && options.preferTextFallback && response.text) {
    const text = await response.text()
    const buffer = Buffer.from(text)
    assertKnownSizeWithinLimit(buffer.byteLength, options.maxBytes, options.label)
    return buffer
  }
  if (!response.body && response.arrayBuffer) {
    const buffer = Buffer.from(await response.arrayBuffer())
    assertKnownSizeWithinLimit(buffer.byteLength, options.maxBytes, options.label)
    if (buffer.byteLength > 0 || !response.text) {
      return buffer
    }
    const text = await response.text()
    const textBuffer = Buffer.from(text)
    assertKnownSizeWithinLimit(textBuffer.byteLength, options.maxBytes, options.label)
    return textBuffer
  }
  if (!response.body && response.text) {
    const text = await response.text()
    const buffer = Buffer.from(text)
    assertKnownSizeWithinLimit(buffer.byteLength, options.maxBytes, options.label)
    return buffer
  }
  return readStreamToBufferWithLimit(response.body, options)
}

export async function readResponseTextWithLimit(
  response: {
    headers?: { get(name: string): string | null }
    body?: ReadableStream<Uint8Array> | null
    arrayBuffer?: () => Promise<ArrayBuffer>
    text?: () => Promise<string>
  },
  options: ReadResponseWithLimitOptions
): Promise<string> {
  return (
    await readResponseToBufferWithLimit(response, { ...options, preferTextFallback: true })
  ).toString('utf-8')
}

export async function readResponseJsonWithLimit<T = unknown>(
  response: {
    headers?: { get(name: string): string | null }
    body?: ReadableStream<Uint8Array> | null
  },
  options: ReadResponseWithLimitOptions
): Promise<T> {
  return JSON.parse(await readResponseTextWithLimit(response, options)) as T
}

export async function readFileToBufferWithLimit(
  file: File,
  options: { maxBytes: number; label: string }
): Promise<Buffer> {
  assertKnownSizeWithinLimit(file.size, options.maxBytes, options.label)
  const buffer = Buffer.from(await file.arrayBuffer())
  assertKnownSizeWithinLimit(buffer.byteLength, options.maxBytes, options.label)
  return buffer
}

export async function consumeOrCancelBody(
  response: { body?: ReadableStream<Uint8Array> | null },
  maxBytes = DEFAULT_MAX_ERROR_BODY_BYTES
): Promise<void> {
  if (!response.body) return

  try {
    await readStreamToBufferWithLimit(response.body, {
      maxBytes,
      label: 'response body',
    })
  } catch {
    await response.body.cancel().catch(() => {})
  }
}
