import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { setUploadsConfig, uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import { uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListS3ObjectKeyPage } = vi.hoisted(() => ({ mockListS3ObjectKeyPage: vi.fn() }))

vi.mock('@/lib/uploads/config', () => uploadsConfigMock)
vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/uploads/providers/s3/client', () => ({
  listS3ObjectKeyPage: mockListS3ObjectKeyPage,
}))

import { sweepStoragePrefix } from '@/lib/uploads/core/prefix-sweep'

const outbox = { signal: new AbortController().signal }
const deletedKeys = () => storageServiceMockFns.mockDeleteFile.mock.calls.map(([{ key }]) => key)

/** A provider (Azure Blob, GCS, S3-compatibles) may return a short or empty page that is not the last. */
describe('sweepStoragePrefix over a provider listing', () => {
  beforeEach(() => {
    setUploadsConfig({ USE_S3_STORAGE: true, S3_CONFIG: { bucket: 'bucket', region: 'r' } })
    mockListS3ObjectKeyPage.mockReset()
    storageServiceMockFns.mockDeleteFile.mockReset().mockResolvedValue(undefined)
  })

  it('continues after a short page that is not the last', async () => {
    mockListS3ObjectKeyPage.mockResolvedValueOnce({
      keys: ['project/p1/a.txt'],
      nextContinuationToken: 'next',
    })

    expect(await sweepStoragePrefix('project/p1/', 'project', outbox)).toBe('continue')
    expect(deletedKeys()).toEqual(['project/p1/a.txt'])
  })

  it('follows an empty page that is not the last to the objects after it', async () => {
    mockListS3ObjectKeyPage
      .mockResolvedValueOnce({ keys: [], nextContinuationToken: 'next' })
      .mockResolvedValueOnce({ keys: ['project/p1/a.txt'] })

    expect(await sweepStoragePrefix('project/p1/', 'project', outbox)).toBe('done')
    expect(mockListS3ObjectKeyPage.mock.calls[1]?.[0]).toMatchObject({ continuationToken: 'next' })
    expect(deletedKeys()).toEqual(['project/p1/a.txt'])
  })

  it('stalls when its listing stops advancing without removing anything', async () => {
    mockListS3ObjectKeyPage.mockResolvedValue({ keys: [], nextContinuationToken: 'stuck' })

    expect(await sweepStoragePrefix('project/p1/', 'project', outbox)).toBe('stalled')
    expect(mockListS3ObjectKeyPage).toHaveBeenCalledTimes(2)
  })
})
