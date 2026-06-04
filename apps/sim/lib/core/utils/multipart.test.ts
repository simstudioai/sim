/**
 * @vitest-environment node
 */
import type { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { isMultipartError, type MultipartError, readMultipart } from '@/lib/core/utils/multipart'

type Part =
  | { name: string; value: string }
  | { name: string; filename: string; value: string; contentType?: string }

const BOUNDARY = '----testboundary1234'

function buildBody(parts: Part[], boundary = BOUNDARY): Buffer {
  const segments: Buffer[] = []
  for (const part of parts) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`
    if ('filename' in part) {
      header += `; filename="${part.filename}"\r\nContent-Type: ${part.contentType ?? 'text/csv'}`
    }
    header += '\r\n\r\n'
    segments.push(Buffer.from(header, 'utf8'), Buffer.from(part.value, 'utf8'), Buffer.from('\r\n'))
  }
  segments.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
  return Buffer.concat(segments)
}

function toWebStream(body: Buffer, chunkSize?: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (chunkSize) {
        for (let i = 0; i < body.length; i += chunkSize) {
          controller.enqueue(new Uint8Array(body.subarray(i, i + chunkSize)))
        }
      } else {
        controller.enqueue(new Uint8Array(body))
      }
      controller.close()
    },
  })
}

function makeRequest(
  parts: Part[],
  opts?: { chunkSize?: number; contentType?: string; boundary?: string }
) {
  const boundary = opts?.boundary ?? BOUNDARY
  return {
    headers: new Headers({
      'content-type': opts?.contentType ?? `multipart/form-data; boundary=${boundary}`,
    }),
    body: toWebStream(buildBody(parts, boundary), opts?.chunkSize),
  }
}

async function readStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function expectCode(error: unknown, code: MultipartError['code']) {
  expect(isMultipartError(error)).toBe(true)
  expect((error as MultipartError).code).toBe(code)
}

describe('readMultipart', () => {
  it('parses text fields (before the file) and exposes the file stream', async () => {
    const csv = 'name,age\nAlice,30\n'
    const request = makeRequest([
      { name: 'workspaceId', value: 'ws-1' },
      { name: 'file', filename: 'data.csv', value: csv },
    ])

    const { fields, file } = await readMultipart(request, {
      maxFileBytes: 1024,
      requiredFieldsBeforeFile: ['workspaceId'],
    })

    expect(fields.workspaceId).toBe('ws-1')
    expect(file?.filename).toBe('data.csv')
    expect(file?.fieldName).toBe('file')
    expect(await readStream(file!.stream)).toBe(csv)
  })

  it('handles a body delivered in tiny chunks (split mid-boundary)', async () => {
    const csv = 'name,age\nAlice,30\nBob,40\n'
    const request = makeRequest(
      [
        { name: 'workspaceId', value: 'ws-1' },
        { name: 'file', filename: 'data.csv', value: csv },
      ],
      { chunkSize: 3 }
    )

    const { file } = await readMultipart(request, { maxFileBytes: 1024 })
    expect(await readStream(file!.stream)).toBe(csv)
  })

  it('rejects FIELD_AFTER_FILE when a required field comes after the file', async () => {
    const request = makeRequest([
      { name: 'file', filename: 'data.csv', value: 'name\nAlice\n' },
      { name: 'workspaceId', value: 'ws-1' },
    ])

    await readMultipart(request, {
      maxFileBytes: 1024,
      requiredFieldsBeforeFile: ['workspaceId'],
    }).then(
      () => {
        throw new Error('expected rejection')
      },
      (err) => expectCode(err, 'FIELD_AFTER_FILE')
    )
  })

  it('rejects NO_FILE when the body has no file part', async () => {
    const request = makeRequest([{ name: 'workspaceId', value: 'ws-1' }])
    await readMultipart(request, { maxFileBytes: 1024 }).then(
      () => {
        throw new Error('expected rejection')
      },
      (err) => expectCode(err, 'NO_FILE')
    )
  })

  it('rejects NOT_MULTIPART for a non-multipart content type', async () => {
    const request = {
      headers: new Headers({ 'content-type': 'application/json' }),
      body: toWebStream(Buffer.from('{}')),
    }
    await readMultipart(request, { maxFileBytes: 1024 }).then(
      () => {
        throw new Error('expected rejection')
      },
      (err) => expectCode(err, 'NOT_MULTIPART')
    )
  })

  it('errors the file stream with FILE_TOO_LARGE when the cap is exceeded', async () => {
    const request = makeRequest([
      { name: 'workspaceId', value: 'ws-1' },
      { name: 'file', filename: 'big.csv', value: 'x'.repeat(500) },
    ])

    const { file } = await readMultipart(request, { maxFileBytes: 50 })
    await readStream(file!.stream).then(
      () => {
        throw new Error('expected stream error')
      },
      (err) => expectCode(err, 'FILE_TOO_LARGE')
    )
  })

  it('rejects when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const request = makeRequest([
      { name: 'workspaceId', value: 'ws-1' },
      { name: 'file', filename: 'data.csv', value: 'name\nAlice\n' },
    ])

    await expect(
      readMultipart(request, { maxFileBytes: 1024, signal: controller.signal })
    ).rejects.toBeTruthy()
  })

  it('destroys the file stream when the signal aborts mid-upload (after resolve)', async () => {
    const controller = new AbortController()
    // A body that delivers the file-part header but never closes, so the file stream stays open
    // after readMultipart resolves — mimicking a client still uploading.
    let enqueue!: (b: Buffer) => void
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        enqueue = (b) => c.enqueue(new Uint8Array(b))
      },
    })
    const head = Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="workspaceId"\r\n\r\nws-1\r\n`
      ),
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="data.csv"\r\nContent-Type: text/csv\r\n\r\n`
      ),
      Buffer.from('name,age\n'),
    ])
    const request = {
      headers: new Headers({ 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }),
      body,
    }
    enqueue(head)

    const parsed = await readMultipart(request, {
      maxFileBytes: 1024,
      requiredFieldsBeforeFile: ['workspaceId'],
      signal: controller.signal,
    })
    expect(parsed.file).toBeTruthy()

    controller.abort()
    await expect(readStream(parsed.file!.stream)).rejects.toBeTruthy()
  })
})
