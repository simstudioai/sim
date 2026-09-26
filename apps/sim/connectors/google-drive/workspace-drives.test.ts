import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoogleDriveApiError } from '@/connectors/google-drive/google-drive-errors'
import { listGoogleWorkspaceDrives } from '@/connectors/google-drive/workspace-drives'

const mockFetch = vi.fn()
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Google Workspace shared-drive enumeration', () => {
  it('returns one bounded page using only the delegated user token', async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValueOnce(
      json({ drives: [{ id: 'drive-a' }, { id: 'drive-b' }], nextPageToken: 'next-page' })
    )
    await expect(
      listGoogleWorkspaceDrives('delegated-user-token', undefined, controller.signal)
    ).resolves.toEqual({ driveIds: ['drive-a', 'drive-b'], nextPageToken: 'next-page' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [address, init] = mockFetch.mock.calls[0]
    const url = new URL(address)
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/drives')
    expect(url.searchParams.get('pageSize')).toBe('100')
    expect(url.searchParams.get('fields')).toBe('kind,nextPageToken,drives(id)')
    expect(url.searchParams.has('useDomainAdminAccess')).toBe(false)
    expect(url.searchParams.has('pageToken')).toBe(false)
    expect(init.headers.Authorization).toBe('Bearer delegated-user-token')
    expect(init.signal).toBe(controller.signal)
  })

  it('deduplicates repeated drive IDs within one page', async () => {
    mockFetch.mockResolvedValueOnce(json({ drives: [{ id: 'drive-a' }, { id: 'drive-a' }] }))
    await expect(listGoogleWorkspaceDrives('token')).resolves.toEqual({ driveIds: ['drive-a'] })
  })

  it.each([
    {},
    { kind: 'drive#fileList' },
    { drives: null },
    { drives: [{}] },
    { drives: [{ id: 1 }] },
    { drives: [{ id: '' }] },
    { drives: [{ id: 'd'.repeat(257) }] },
    { drives: [], nextPageToken: '' },
    { drives: [], nextPageToken: 't'.repeat(8193) },
    { drives: Array.from({ length: 101 }, (_, index) => ({ id: `drive-${index}` })) },
  ])('rejects malformed or oversized pages', async (body) => {
    mockFetch.mockResolvedValueOnce(json(body))
    await expect(listGoogleWorkspaceDrives('token')).rejects.toThrow('malformed')
  })

  it('caps the response body before parsing it', async () => {
    mockFetch.mockResolvedValueOnce(new Response('x'.repeat(1024 * 1024 + 1)))
    await expect(listGoogleWorkspaceDrives('token')).rejects.toThrow('size limit')
  })

  it('rejects a repeated provider cursor', async () => {
    mockFetch.mockResolvedValueOnce(json({ drives: [], nextPageToken: 'same-page' }))
    await expect(listGoogleWorkspaceDrives('token', 'same-page')).rejects.toThrow('repeated')
  })

  it.each(['', 't'.repeat(8193)])(
    'rejects invalid input cursors before provider access',
    async (cursor) => {
      await expect(listGoogleWorkspaceDrives('token', cursor)).rejects.toThrow('invalid')
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it.each([401, 403, 404])(
    'preserves provider HTTP %i rather than reporting an empty drive list',
    async (status) => {
      mockFetch.mockResolvedValueOnce(
        json({ error: { errors: [{ reason: 'forbidden' }] } }, status)
      )
      await expect(listGoogleWorkspaceDrives('token')).rejects.toMatchObject<
        Partial<GoogleDriveApiError>
      >({
        status,
      })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    }
  )
})
