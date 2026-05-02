/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DirectUploadError,
  type PresignedUploadInfo,
  runUploadStrategy,
} from '@/lib/uploads/client/direct-upload'

const ONE_MB = 1024 * 1024
const LARGE_THRESHOLD = 50 * ONE_MB

const makeFile = (size: number, name = 'test.bin', type = 'application/octet-stream'): File => {
  const file = new File([new Uint8Array(0)], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const presigned = (overrides?: Partial<PresignedUploadInfo>): PresignedUploadInfo => ({
  fileName: 'test.bin',
  presignedUrl: 'https://s3/presigned',
  fileInfo: {
    path: '/api/files/serve/test',
    key: 'workspace/ws-1/test.bin',
    name: 'test.bin',
    size: ONE_MB,
    type: 'application/octet-stream',
  },
  uploadHeaders: undefined,
  directUploadSupported: true,
  ...overrides,
})

class MockXHR {
  static instances: MockXHR[] = []
  upload = { addEventListener: vi.fn() }
  status = 200
  statusText = 'OK'
  private listeners: Record<string, Array<() => void>> = {}
  open = vi.fn()
  setRequestHeader = vi.fn()
  abort = vi.fn()
  send = vi.fn(() => {
    queueMicrotask(() => this.listeners.load?.forEach((cb) => cb()))
  })
  addEventListener = (event: string, cb: () => void) => {
    ;(this.listeners[event] ??= []).push(cb)
  }
  removeEventListener = vi.fn()
  constructor() {
    MockXHR.instances.push(this)
  }
}

describe('runUploadStrategy', () => {
  let originalXHR: typeof XMLHttpRequest

  beforeEach(() => {
    MockXHR.instances = []
    originalXHR = globalThis.XMLHttpRequest
    globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR
    vi.restoreAllMocks()
  })

  it('uses presigned PUT for files at or below the multipart threshold', async () => {
    const file = makeFile(LARGE_THRESHOLD)

    const result = await runUploadStrategy({
      file,
      workspaceId: 'ws-1',
      context: 'workspace',
      presignedOverride: presigned(),
    })

    expect(result.key).toBe('workspace/ws-1/test.bin')
    expect(MockXHR.instances).toHaveLength(1)
    expect(MockXHR.instances[0].open).toHaveBeenCalledWith('PUT', 'https://s3/presigned')
  })

  it('throws FALLBACK_REQUIRED when server signals no cloud storage', async () => {
    const file = makeFile(ONE_MB)

    await expect(
      runUploadStrategy({
        file,
        workspaceId: 'ws-1',
        context: 'workspace',
        presignedOverride: presigned({ presignedUrl: '', directUploadSupported: false }),
      })
    ).rejects.toMatchObject({
      name: 'DirectUploadError',
      code: 'FALLBACK_REQUIRED',
    })
  })

  it('takes the multipart path for files larger than the threshold and posts unified parts', async () => {
    const file = makeFile(LARGE_THRESHOLD + ONE_MB)
    const calls: Array<{ url: string; body: unknown }> = []

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const rawBody = init?.body
      const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : undefined
      calls.push({ url, body })

      if (url.includes('action=initiate')) {
        return new Response(
          JSON.stringify({ uploadId: 'u1', key: 'workspace/ws-1/big.bin', uploadToken: 't' }),
          { status: 200 }
        )
      }
      if (url.includes('action=get-part-urls')) {
        return new Response(
          JSON.stringify({
            presignedUrls: [
              { partNumber: 1, url: 'https://s3/part1' },
              { partNumber: 2, url: 'https://s3/part2' },
            ],
          }),
          { status: 200 }
        )
      }
      if (url.startsWith('https://s3/part')) {
        return new Response(null, { status: 200, headers: { ETag: '"etag-x"' } })
      }
      if (url.includes('action=complete')) {
        return new Response(JSON.stringify({ path: '/api/files/serve/big' }), { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const result = await runUploadStrategy({
      file,
      workspaceId: 'ws-1',
      context: 'workspace',
    })

    expect(result.path).toBe('/api/files/serve/big')

    const completeCall = calls.find((c) => c.url.includes('action=complete'))!
    expect(completeCall.body).toMatchObject({
      uploadToken: 't',
      parts: [
        { partNumber: 1, etag: 'etag-x' },
        { partNumber: 2, etag: 'etag-x' },
      ],
    })
  })

  it('rejects with ABORTED when signal is already aborted before PUT begins', async () => {
    const file = makeFile(ONE_MB)
    const controller = new AbortController()
    controller.abort()

    await expect(
      runUploadStrategy({
        file,
        workspaceId: 'ws-1',
        context: 'workspace',
        presignedOverride: presigned(),
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'DirectUploadError', code: 'ABORTED' })
  })

  it('fires action=abort when the multipart complete call fails', async () => {
    const file = makeFile(LARGE_THRESHOLD + ONE_MB)
    const calls: Array<{ url: string }> = []

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push({ url })

      if (url.includes('action=initiate')) {
        return new Response(
          JSON.stringify({ uploadId: 'u1', key: 'workspace/ws-1/big.bin', uploadToken: 't' }),
          { status: 200 }
        )
      }
      if (url.includes('action=get-part-urls')) {
        return new Response(
          JSON.stringify({
            presignedUrls: [
              { partNumber: 1, url: 'https://s3/part1' },
              { partNumber: 2, url: 'https://s3/part2' },
            ],
          }),
          { status: 200 }
        )
      }
      if (url.startsWith('https://s3/part')) {
        return new Response(null, { status: 200, headers: { ETag: '"etag-x"' } })
      }
      if (url.includes('action=complete')) {
        return new Response(JSON.stringify({ error: 'kaboom' }), { status: 500 })
      }
      if (url.includes('action=abort')) {
        return new Response(null, { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runUploadStrategy({ file, workspaceId: 'ws-1', context: 'workspace' })
    ).rejects.toBeInstanceOf(DirectUploadError)

    expect(calls.some((c) => c.url.includes('action=abort'))).toBe(true)
  })

  it('throws when neither presignedEndpoint nor presignedOverride is supplied', async () => {
    const file = makeFile(ONE_MB)
    await expect(
      runUploadStrategy({ file, workspaceId: 'ws-1', context: 'workspace' })
    ).rejects.toBeInstanceOf(DirectUploadError)
  })
})
