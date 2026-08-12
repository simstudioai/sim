import { describe, expect, it } from 'vitest'
import { v2UploadTransferSchema } from '@/lib/api/contracts/v2/uploads'

describe('v2 upload transfer contracts', () => {
  it('discriminates a PUT transfer from multipart geometry', () => {
    expect(
      v2UploadTransferSchema.parse({
        method: 'put',
        url: 'https://storage.example/upload',
        headers: { 'Content-Type': 'application/octet-stream' },
        expiresAt: '2026-01-01T01:00:00.000Z',
      })
    ).toMatchObject({ method: 'put', expiresAt: '2026-01-01T01:00:00.000Z' })
    expect(
      v2UploadTransferSchema.parse({
        method: 'multipart',
        partSize: 8 * 1024 * 1024,
        partCount: 7,
      })
    ).toMatchObject({ method: 'multipart' })
    expect(
      v2UploadTransferSchema.safeParse({
        method: 'put',
        partSize: 8 * 1024 * 1024,
        partCount: 1,
      }).success
    ).toBe(false)
  })

  it('requires a PUT transfer to advertise its own URL expiry', () => {
    expect(
      v2UploadTransferSchema.safeParse({
        method: 'put',
        url: 'https://storage.example/upload',
        headers: { 'Content-Type': 'application/octet-stream' },
      }).success
    ).toBe(false)
  })
})
