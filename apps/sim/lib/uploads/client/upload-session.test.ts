/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateUploadTimeoutMs, uploadFileSession } from '@/lib/uploads/client/upload-session'

const MIB = 1024 * 1024
const PUT_THRESHOLD = 50 * MIB

function sizedFile(size: number): File {
  const file = new File([], 'data.bin', { type: 'application/octet-stream' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

class MockXhr extends EventTarget {
  static instances: MockXhr[] = []
  static onSend: (xhr: MockXhr) => void = (xhr) => {
    queueMicrotask(() => xhr.dispatchEvent(new Event('load')))
  }

  readonly upload = new EventTarget()
  readonly requestHeaders = new Map<string, string>()
  status = 200
  statusText = 'OK'
  timeout = 0
  responseHeaders = new Map<string, string>()
  open = vi.fn()
  abort = vi.fn()
  send = vi.fn(() => MockXhr.onSend(this))

  constructor() {
    super()
    MockXhr.instances.push(this)
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders.set(name, value)
  }

  getResponseHeader(name: string) {
    return this.responseHeaders.get(name) ?? null
  }
}

describe('uploadFileSession', () => {
  const originalXhr = globalThis.XMLHttpRequest

  beforeEach(() => {
    MockXhr.instances = []
    MockXhr.onSend = (xhr) => queueMicrotask(() => xhr.dispatchEvent(new Event('load')))
    globalThis.XMLHttpRequest = MockXhr as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXhr
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uploads an exact-threshold file with PUT and completes with an empty body', async () => {
    const file = sizedFile(PUT_THRESHOLD)
    const complete = vi.fn(async () => 'done')
    const abort = vi.fn(async () => undefined)
    const onProgress = vi.fn()

    await expect(
      uploadFileSession({
        file,
        transfer: {
          method: 'put',
          url: 'https://storage.example/upload',
          headers: { 'Content-Type': 'application/octet-stream', 'x-upload': 'signed' },
        },
        complete,
        abort,
        onProgress,
      })
    ).resolves.toBe('done')

    expect(MockXhr.instances).toHaveLength(1)
    expect(MockXhr.instances[0].open).toHaveBeenCalledWith('PUT', 'https://storage.example/upload')
    expect(MockXhr.instances[0].requestHeaders).toEqual(
      new Map([
        ['Content-Type', 'application/octet-stream'],
        ['x-upload', 'signed'],
      ])
    )
    expect(MockXhr.instances[0].timeout).toBe(calculateUploadTimeoutMs(file.size))
    expect(complete).toHaveBeenCalledWith()
    expect(onProgress).toHaveBeenLastCalledWith({
      loaded: PUT_THRESHOLD,
      total: PUT_THRESHOLD,
      percent: 100,
    })
    expect(abort).not.toHaveBeenCalled()
  })

  it('uploads an empty file with PUT and reports finite completion progress', async () => {
    const complete = vi.fn(async () => 'done')
    const onProgress = vi.fn()

    await expect(
      uploadFileSession({
        file: sizedFile(0),
        transfer: { method: 'put', url: 'https://storage.example/upload', headers: {} },
        complete,
        abort: vi.fn(async () => undefined),
        onProgress,
      })
    ).resolves.toBe('done')

    expect(complete).toHaveBeenCalledWith()
    expect(onProgress).toHaveBeenLastCalledWith({ loaded: 0, total: 0, percent: 100 })
  })

  it('uploads a file above the threshold through bounded multipart batches', async () => {
    const file = sizedFile(PUT_THRESHOLD + 1)
    const partSize = 8 * MIB
    const partCount = Math.ceil(file.size / partSize)
    const getPartUrls = vi.fn(async (partNumbers: number[]) =>
      [...partNumbers].reverse().map((partNumber) => ({
        partNumber,
        url: `https://storage.example/parts/${partNumber}`,
        headers: { 'Content-Type': 'application/octet-stream' },
        expiresAt: '2026-08-05T00:00:00.000Z',
      }))
    )
    const complete = vi.fn(async () => 'done')
    const abort = vi.fn(async () => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200, headers: { etag: '"part-etag"' } }))
    )

    await expect(
      uploadFileSession({
        file,
        transfer: { method: 'multipart', partSize, partCount },
        getPartUrls,
        complete,
        abort,
      })
    ).resolves.toBe('done')

    expect(getPartUrls).toHaveBeenCalledWith(Array.from({ length: partCount }, (_, i) => i + 1))
    expect(complete).toHaveBeenCalledWith()
    expect(abort).not.toHaveBeenCalled()
  })

  it('does not retry a deterministic PUT 4xx', async () => {
    MockXhr.onSend = (xhr) => {
      xhr.status = 403
      xhr.statusText = 'Forbidden'
      queueMicrotask(() => xhr.dispatchEvent(new Event('load')))
    }
    const abort = vi.fn(async () => undefined)

    await expect(
      uploadFileSession({
        file: sizedFile(1),
        transfer: { method: 'put', url: 'https://storage.example/upload', headers: {} },
        complete: vi.fn(),
        abort,
      })
    ).rejects.toMatchObject({ status: 403 })

    expect(MockXhr.instances).toHaveLength(1)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('retains a completed PUT transfer when completion fails', async () => {
    const abort = vi.fn(async () => undefined)

    await expect(
      uploadFileSession({
        file: sizedFile(1),
        transfer: { method: 'put', url: 'https://storage.example/upload', headers: {} },
        complete: async () => {
          throw new Error('finalizer unavailable')
        },
        abort,
      })
    ).rejects.toThrow('finalizer unavailable')

    expect(abort).not.toHaveBeenCalled()
  })

  it('retries transient PUT failures and keeps progress monotonic', async () => {
    vi.useFakeTimers()
    const onProgress = vi.fn()
    MockXhr.onSend = (xhr) => {
      const attempt = MockXhr.instances.length
      if (attempt === 1) {
        xhr.upload.dispatchEvent(
          new ProgressEvent('progress', { lengthComputable: true, loaded: 8, total: 10 })
        )
        queueMicrotask(() => xhr.dispatchEvent(new Event('error')))
        return
      }
      xhr.upload.dispatchEvent(
        new ProgressEvent('progress', { lengthComputable: true, loaded: 2, total: 10 })
      )
      queueMicrotask(() => xhr.dispatchEvent(new Event('load')))
    }

    const promise = uploadFileSession({
      file: sizedFile(10),
      transfer: { method: 'put', url: 'https://storage.example/upload', headers: {} },
      complete: async () => 'done',
      abort: async () => undefined,
      onProgress,
    })
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toBe('done')
    expect(MockXhr.instances).toHaveLength(2)
    expect(onProgress.mock.calls.map(([event]) => event.loaded)).toEqual([8, 8, 10])
  })

  it('completes a retried PUT whose create-only precondition already committed the object', async () => {
    vi.useFakeTimers()
    MockXhr.onSend = (xhr) => {
      const attempt = MockXhr.instances.length
      if (attempt === 1) {
        queueMicrotask(() => xhr.dispatchEvent(new Event('error')))
        return
      }
      xhr.status = 412
      xhr.statusText = 'Precondition Failed'
      queueMicrotask(() => xhr.dispatchEvent(new Event('load')))
    }
    const complete = vi.fn(async () => 'done')
    const abort = vi.fn(async () => undefined)
    const onProgress = vi.fn()

    const promise = uploadFileSession({
      file: sizedFile(10),
      transfer: { method: 'put', url: 'https://storage.example/upload', headers: {} },
      complete,
      abort,
      onProgress,
    })
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toBe('done')
    expect(MockXhr.instances).toHaveLength(2)
    expect(complete).toHaveBeenCalledWith()
    expect(abort).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenLastCalledWith({ loaded: 10, total: 10, percent: 100 })
  })

  it('does not treat a first-attempt PUT conflict as a committed object', async () => {
    MockXhr.onSend = (xhr) => {
      xhr.status = 412
      xhr.statusText = 'Precondition Failed'
      queueMicrotask(() => xhr.dispatchEvent(new Event('load')))
    }
    const complete = vi.fn()
    const abort = vi.fn(async () => undefined)

    await expect(
      uploadFileSession({
        file: sizedFile(1),
        transfer: { method: 'put', url: 'https://storage.example/upload', headers: {} },
        complete,
        abort,
      })
    ).rejects.toMatchObject({ status: 412 })

    expect(MockXhr.instances).toHaveLength(1)
    expect(complete).not.toHaveBeenCalled()
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('aborts XHR and the control session when the caller cancels', async () => {
    const controller = new AbortController()
    MockXhr.onSend = () => undefined
    const abort = vi.fn(async () => undefined)
    const promise = uploadFileSession({
      file: sizedFile(10),
      transfer: { method: 'put', url: 'https://storage.example/upload', headers: {} },
      complete: vi.fn(),
      abort,
      signal: controller.signal,
    })

    controller.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(MockXhr.instances[0].abort).toHaveBeenCalledTimes(1)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('fails before uploading when a multipart URL batch is incomplete', async () => {
    const abort = vi.fn(async () => undefined)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      uploadFileSession({
        file: sizedFile(2),
        transfer: { method: 'multipart', partSize: 1, partCount: 2 },
        getPartUrls: async () => [
          {
            partNumber: 1,
            url: 'https://storage.example/parts/1',
            headers: {},
            expiresAt: '2026-08-05T00:00:00.000Z',
          },
        ],
        complete: vi.fn(),
        abort,
      })
    ).rejects.toThrow('Expected 2 part URLs; received 1')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('does not retry a multipart 4xx response', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      uploadFileSession({
        file: sizedFile(1),
        transfer: { method: 'multipart', partSize: 1, partCount: 1 },
        getPartUrls: async () => [
          {
            partNumber: 1,
            url: 'https://storage.example/parts/1',
            headers: {},
            expiresAt: '2026-08-05T00:00:00.000Z',
          },
        ],
        complete: vi.fn(),
        abort: async () => undefined,
      })
    ).rejects.toMatchObject({ status: 403 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retains a completed multipart transfer when completion fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 }))
    )
    const abort = vi.fn(async () => undefined)

    await expect(
      uploadFileSession({
        file: sizedFile(1),
        transfer: { method: 'multipart', partSize: 1, partCount: 1 },
        getPartUrls: async () => [
          {
            partNumber: 1,
            url: 'https://storage.example/parts/1',
            headers: {},
            expiresAt: '2026-08-05T00:00:00.000Z',
          },
        ],
        complete: async () => {
          throw new Error('finalizer unavailable')
        },
        abort,
      })
    ).rejects.toThrow('finalizer unavailable')

    expect(abort).not.toHaveBeenCalled()
  })
})
