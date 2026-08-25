/**
 * @vitest-environment node
 */

import { Readable } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import {
  assertContentLengthWithinLimit,
  MultipartFieldValidationError,
  PayloadSizeLimitError,
  readFileToBufferWithLimit,
  readFormDataWithLimit,
  readNodeStreamToBufferWithLimit,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(chunks[index])
      index += 1
    },
  })
}

/**
 * Builds a raw multipart body by hand. `FormData` percent-escapes a NUL out of
 * a filename on serialization, so a hand-written part is the only way to put
 * the byte on the wire exactly as a real client can.
 */
function multipartRequest(
  disposition: string,
  value: string,
  options: { declareContentLength?: boolean } = {}
): Request {
  const boundary = 'streamlimitsboundary'
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; ${disposition}\r\n` +
    `Content-Type: text/plain\r\n\r\n${value}\r\n` +
    `--${boundary}--\r\n`
  const bytes = new TextEncoder().encode(body)
  const requestHeaders = new Headers({
    'content-type': `multipart/form-data; boundary=${boundary}`,
  })
  if (options.declareContentLength) {
    requestHeaders.set('content-length', String(bytes.byteLength))
  }
  return new Request('http://localhost/upload', {
    method: 'POST',
    headers: requestHeaders,
    body: bytes,
  })
}

const NUL_MULTIPART_PARTS = [
  ['a NUL in a file name', 'name="file"; filename="apitest_\u0000x.txt"', 'hello'],
  ['a NUL in a text field value', 'name="label"', 'apitest_\u0000x'],
  ['a NUL in a field name', 'name="apitest_\u0000x"', 'hello'],
] as const

function headers(contentLength?: string): Headers {
  const headers = new Headers()
  if (contentLength !== undefined) headers.set('content-length', contentLength)
  return headers
}

describe('stream limits', () => {
  it('reads a stream under the limit', async () => {
    const buffer = await readStreamToBufferWithLimit(
      streamFromChunks([new TextEncoder().encode('hello'), new TextEncoder().encode(' world')]),
      { maxBytes: 32, label: 'test payload' }
    )

    expect(buffer.toString('utf-8')).toBe('hello world')
  })

  it('rejects when content-length is over the limit', () => {
    expect(() => assertContentLengthWithinLimit(headers('11'), 10, 'download')).toThrow(
      PayloadSizeLimitError
    )
  })

  it('cancels response bodies when content-length preflight rejects', async () => {
    const cancelSpy = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      cancel: cancelSpy,
    })

    await expect(
      readResponseToBufferWithLimit(
        {
          headers: headers('11'),
          body,
        },
        { maxBytes: 10, label: 'download' }
      )
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('allows content-length exactly at the limit', () => {
    expect(() => assertContentLengthWithinLimit(headers('10'), 10, 'download')).not.toThrow()
  })

  it('rejects when streamed bytes exceed the limit', async () => {
    await expect(
      readStreamToBufferWithLimit(streamFromChunks([new Uint8Array(6), new Uint8Array(5)]), {
        maxBytes: 10,
        label: 'download',
      })
    ).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
      maxBytes: 10,
      observedBytes: 11,
    })
  })

  it('rejects underreported content-length via streamed byte counting', async () => {
    await expect(
      readResponseToBufferWithLimit(
        {
          headers: headers('5'),
          body: streamFromChunks([new Uint8Array(6), new Uint8Array(5)]),
        },
        { maxBytes: 10, label: 'download' }
      )
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it('returns an empty buffer for a missing body', async () => {
    const buffer = await readResponseToBufferWithLimit(
      { headers: headers('0'), body: null },
      { maxBytes: 10, label: 'empty response' }
    )

    expect(buffer.length).toBe(0)
  })

  it('reads text and JSON responses with limits', async () => {
    const text = await readResponseTextWithLimit(
      { body: streamFromChunks([new TextEncoder().encode('hello')]) },
      { maxBytes: 10, label: 'text response' }
    )
    const json = await readResponseJsonWithLimit<{ ok: boolean }>(
      { body: streamFromChunks([new TextEncoder().encode('{"ok":true}')]) },
      { maxBytes: 20, label: 'json response' }
    )

    expect(text).toBe('hello')
    expect(json.ok).toBe(true)
  })

  it('prefers arrayBuffer over text for binary response fallbacks', async () => {
    const bytes = Uint8Array.from([0, 255, 1, 254])
    const arrayBuffer = vi.fn(async () => bytes.buffer)
    const text = vi.fn(async () => 'corrupted')

    const buffer = await readResponseToBufferWithLimit(
      { headers: headers(String(bytes.byteLength)), arrayBuffer, text },
      { maxBytes: 10, label: 'binary response' }
    )

    expect(buffer).toEqual(Buffer.from(bytes))
    expect(arrayBuffer).toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
  })

  it('rejects no-body response fallbacks without a trusted content-length', async () => {
    await expect(
      readResponseToBufferWithLimit(
        {
          arrayBuffer: vi.fn(async () => new Uint8Array(1024).buffer),
        },
        { maxBytes: 10, label: 'unknown response' }
      )
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it('does not let the text convenience reader bypass the bodyless fail-closed rule', async () => {
    const text = vi.fn(async () => 'small but not independently bounded')

    await expect(
      readResponseTextWithLimit(
        { body: null, text },
        { maxBytes: 100, label: 'unknown text response' }
      )
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
    expect(text).not.toHaveBeenCalled()
  })

  it('rejects an undeclared bodyless response even without a fallback materializer', async () => {
    await expect(
      readResponseToBufferWithLimit(
        { body: null },
        { maxBytes: 100, label: 'unknown empty response' }
      )
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it('allows a bodyless fallback only with a trusted length or explicit declaration', async () => {
    const declared = await readResponseTextWithLimit(
      { headers: headers('5'), body: null, text: async () => 'hello' },
      { maxBytes: 5, label: 'declared response' }
    )
    const explicitlyBounded = await readResponseTextWithLimit(
      { body: null, text: async () => 'hello' },
      { maxBytes: 5, label: 'trusted fallback', allowNoBodyFallback: true }
    )

    expect(declared).toBe('hello')
    expect(explicitlyBounded).toBe('hello')
  })

  it.each([204, 205, 304])('accepts a semantically bodyless HTTP %i response', async (status) => {
    const text = vi.fn(async () => 'must not be materialized')

    const result = await readResponseTextWithLimit(
      { status, headers: headers('1000'), body: null, text },
      { maxBytes: 100, label: 'bodyless response' }
    )

    expect(result).toBe('')
    expect(text).not.toHaveBeenCalled()
  })

  it('accepts a semantically bodyless HEAD response', async () => {
    const text = vi.fn(async () => 'must not be materialized')

    const result = await readResponseTextWithLimit(
      { status: 200, headers: headers('1000'), body: null, text },
      { maxBytes: 100, label: 'HEAD response', requestMethod: 'HEAD' }
    )

    expect(result).toBe('')
    expect(text).not.toHaveBeenCalled()
  })

  it('cancels when the abort signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    const cancelSpy = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('content'))
      },
      cancel: cancelSpy,
    })

    await expect(
      readStreamToBufferWithLimit(stream, {
        maxBytes: 100,
        label: 'abortable',
        signal: controller.signal,
      })
    ).rejects.toThrow('stop')
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('checks file size before materializing a File', async () => {
    const file = new File(['hello'], 'small.txt', { type: 'text/plain' })
    const buffer = await readFileToBufferWithLimit(file, { maxBytes: 5, label: 'upload file' })

    expect(buffer.toString('utf-8')).toBe('hello')
    await expect(
      readFileToBufferWithLimit(file, { maxBytes: 4, label: 'upload file' })
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it('parses multipart form data without requiring content-length', async () => {
    const input = new FormData()
    input.append('name', 'example')
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      body: input,
    })

    expect(request.headers.get('content-length')).toBeNull()

    const formData = await readFormDataWithLimit(request, {
      maxBytes: 1024 * 1024,
      label: 'multipart body',
    })

    expect(formData.get('name')).toBe('example')
  })

  it.each(NUL_MULTIPART_PARTS)(
    'rejects a streamed multipart body carrying %s',
    async (_label, disposition, value) => {
      await expect(
        readFormDataWithLimit(multipartRequest(disposition, value), {
          maxBytes: 1024 * 1024,
          label: 'multipart body',
        })
      ).rejects.toBeInstanceOf(MultipartFieldValidationError)
    }
  )

  /**
   * A declared `content-length` takes the reader's other branch — the one every
   * ordinary browser and curl upload takes — and it scans fields separately.
   */
  it.each(NUL_MULTIPART_PARTS)(
    'rejects a content-length multipart body carrying %s',
    async (_label, disposition, value) => {
      const request = multipartRequest(disposition, value, { declareContentLength: true })
      expect(request.headers.get('content-length')).not.toBeNull()

      await expect(
        readFormDataWithLimit(request, { maxBytes: 1024 * 1024, label: 'multipart body' })
      ).rejects.toBeInstanceOf(MultipartFieldValidationError)
    }
  )

  it('rejects multipart streams without content-length once bytes exceed the limit', async () => {
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
      body: streamFromChunks([new Uint8Array(6), new Uint8Array(5)]),
      duplex: 'half',
    } as RequestInit)

    await expect(
      readFormDataWithLimit(request, { maxBytes: 10, label: 'multipart body' })
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it('rechecks materialized file bytes after arrayBuffer', async () => {
    const file = {
      size: 1,
      arrayBuffer: vi.fn(async () => new Uint8Array(6).buffer),
    } as unknown as File

    await expect(
      readFileToBufferWithLimit(file, { maxBytes: 5, label: 'upload file' })
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })

  it('rejects node streams that exceed the limit', async () => {
    await expect(
      readNodeStreamToBufferWithLimit(Readable.from([Buffer.alloc(6), Buffer.alloc(5)]), {
        maxBytes: 10,
        label: 'storage download',
      })
    ).rejects.toBeInstanceOf(PayloadSizeLimitError)
  })
})
