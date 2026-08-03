/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { V2CompletedPart } from '@/lib/api/contracts/v2/uploads'
import { uploadMultipartSession } from '@/lib/uploads/client/multipart-session'

describe('uploadMultipartSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests fresh URL batches and completes with every uploaded part in order', async () => {
    const file = new File(['abcdefghijklmnopqrstuvwxyz'], 'letters.txt')
    const getPartUrls = vi.fn(async (partNumbers: number[]) =>
      partNumbers.map((partNumber) => ({
        partNumber,
        url: `https://storage.example/part/${partNumber}`,
        headers: { 'Content-Type': 'application/octet-stream' },
        expiresAt: '2026-08-03T22:00:00.000Z',
      }))
    )
    const complete = vi.fn(async (parts: V2CompletedPart[]) => parts)
    const abort = vi.fn(async () => {})
    const onProgress = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string) => new Response(null, { status: 200, headers: { etag: '"etag"' } })
      )
    )

    const result = await uploadMultipartSession({
      file,
      partSize: 1,
      partCount: 26,
      getPartUrls,
      complete,
      abort,
      onProgress,
    })

    expect(getPartUrls).toHaveBeenCalledTimes(2)
    expect(getPartUrls.mock.calls[0][0]).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1)
    )
    expect(getPartUrls.mock.calls[1][0]).toEqual([26])
    expect(result).toHaveLength(26)
    expect(result[0]).toEqual({ partNumber: 1, etag: 'etag' })
    expect(result[25]).toEqual({ partNumber: 26, etag: 'etag' })
    expect(onProgress).toHaveBeenLastCalledWith({ loaded: 26, total: 26, percent: 100 })
    expect(abort).not.toHaveBeenCalled()
  })

  it('aborts the durable session when a part upload is aborted', async () => {
    const file = new File(['part'], 'part.txt')
    const complete = vi.fn()
    const abort = vi.fn(async () => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted', 'AbortError')
      })
    )

    await expect(
      uploadMultipartSession({
        file,
        partSize: 4,
        partCount: 1,
        getPartUrls: async () => [
          {
            partNumber: 1,
            url: 'https://storage.example/part/1',
            headers: {},
            expiresAt: '2026-08-03T22:00:00.000Z',
          },
        ],
        complete,
        abort,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(abort).toHaveBeenCalledTimes(1)
    expect(complete).not.toHaveBeenCalled()
  })
})
