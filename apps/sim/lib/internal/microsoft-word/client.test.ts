/**
 * @vitest-environment node
 */
import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { replaceContentIfUnchanged } from '@/lib/internal/microsoft-word/client'

const { mockValidateUrlWithDNS, mockSecureFetchWithPinnedIP } = inputValidationMockFns

const BASE_PATH = 'https://graph.microsoft.com/v1.0/me/drive/items/doc-abc'
const UPLOAD_URL = 'https://sn3302.up.1drv.com/up/session-abc'

/** Graph's `createUploadSession` response. */
function sessionResponse() {
  const body = { uploadUrl: UPLOAD_URL, expirationDateTime: '2026-01-01T00:00:00Z' }
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

/** A 202 acknowledging a non-final fragment; carries no driveItem. */
function fragmentAccepted() {
  const body = { nextExpectedRanges: ['1-'] }
  return {
    ok: true,
    status: 202,
    statusText: 'Accepted',
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

/** The final fragment's response, carrying the completed driveItem. */
function completedItem() {
  const body = { id: 'doc-abc', name: 'notes.docx', size: 123 }
  return {
    ok: true,
    status: 201,
    statusText: 'Created',
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function preconditionFailed() {
  return {
    ok: false,
    status: 412,
    statusText: 'Precondition Failed',
    headers: new Headers(),
    body: null,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

/** Parses a `Content-Range: bytes {start}-{end}/{total}` header. */
function parseRange(header: string): { start: number; end: number; total: number } {
  const [range, total] = header.replace('bytes ', '').split('/')
  const [start, end] = range.split('-').map(Number)
  return { start, end, total: Number(total) }
}

beforeEach(() => {
  /** Reset so an unconsumed one-time result cannot leak into the next test. */
  mockSecureFetchWithPinnedIP.mockReset()
  mockValidateUrlWithDNS.mockReset()
  mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: '93.184.216.34',
    originalHostname: 'graph.microsoft.com',
  })
})

describe('replaceContentIfUnchanged', () => {
  it('sends a small package as a single fragment', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(completedItem())

    await replaceContentIfUnchanged(BASE_PATH, 'token', Buffer.alloc(1024), 'tag-1')

    const puts = mockSecureFetchWithPinnedIP.mock.calls.filter((c) => c[2]?.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(parseRange(puts[0][2].headers['Content-Range'])).toEqual({
      start: 0,
      end: 1023,
      total: 1024,
    })
  })

  it('splits a package larger than one fragment into contiguous ordered ranges', async () => {
    /** The package exceeds one upload fragment. */
    const size = 25 * 1024 * 1024
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(fragmentAccepted())
      .mockResolvedValueOnce(fragmentAccepted())
      .mockResolvedValueOnce(completedItem())

    const item = await replaceContentIfUnchanged(BASE_PATH, 'token', Buffer.alloc(size), 'tag-1')
    expect(item.id).toBe('doc-abc')

    const puts = mockSecureFetchWithPinnedIP.mock.calls.filter((c) => c[2]?.method === 'PUT')
    expect(puts).toHaveLength(3)

    let expectedStart = 0
    for (const put of puts) {
      const { start, end, total } = parseRange(put[2].headers['Content-Range'])
      expect(total).toBe(size)
      expect(start).toBe(expectedStart)
      /** Every non-final fragment must be a multiple of 320 KiB. */
      const length = end - start + 1
      expect(Number(put[2].headers['Content-Length'])).toBe(length)
      if (end !== size - 1) expect(length % (320 * 1024)).toBe(0)
      expectedStart = end + 1
    }
    expect(expectedStart).toBe(size)
  })

  it('never sends the bearer token to the preauthenticated upload URL', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(completedItem())

    await replaceContentIfUnchanged(BASE_PATH, 'token', Buffer.alloc(64), 'tag-1')

    const put = mockSecureFetchWithPinnedIP.mock.calls.find((c) => c[2]?.method === 'PUT')
    expect(put?.[0]).toBe(UPLOAD_URL)
    expect(put?.[2].headers.Authorization).toBeUndefined()
  })

  it('carries the precondition on the session and maps its rejection to a conflict', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(preconditionFailed())

    await expect(
      replaceContentIfUnchanged(BASE_PATH, 'token', Buffer.alloc(64), 'tag-1')
    ).rejects.toMatchObject({ status: 409 })

    const session = mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(session[0]).toBe(`${BASE_PATH}/createUploadSession`)
    expect(session[2].headers['if-match']).toBe('tag-1')
    /** The rejected precondition prevents any content upload. */
    expect(mockSecureFetchWithPinnedIP.mock.calls.some((c) => c[2]?.method === 'PUT')).toBe(false)
  })

  it('maps a conflict raised part-way through the fragments to the same error', async () => {
    mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(fragmentAccepted())
      .mockResolvedValueOnce(preconditionFailed())

    await expect(
      replaceContentIfUnchanged(BASE_PATH, 'token', Buffer.alloc(25 * 1024 * 1024), 'tag-1')
    ).rejects.toMatchObject({ status: 409 })
  })

  it('fails loudly when the session response carries no upload URL', async () => {
    const body = { expirationDateTime: '2026-01-01T00:00:00Z' }
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: '',
      headers: new Headers(),
      body: null,
      text: async () => JSON.stringify(body),
      json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(0),
    })

    await expect(
      replaceContentIfUnchanged(BASE_PATH, 'token', Buffer.alloc(64), 'tag-1')
    ).rejects.toThrow(/did not return an upload URL/)
  })
})
