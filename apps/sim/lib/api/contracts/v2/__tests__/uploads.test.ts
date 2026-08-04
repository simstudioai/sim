import { describe, expect, it } from 'vitest'
import { v2CompleteUploadBodySchema, v2UploadTransferSchema } from '@/lib/api/contracts/v2/uploads'

describe('v2 upload transfer contracts', () => {
  it('accepts only an empty object for PUT completion', () => {
    expect(v2CompleteUploadBodySchema.parse({})).toEqual({})
    expect(v2CompleteUploadBodySchema.safeParse({ method: 'put' }).success).toBe(false)
  })

  it('accepts a strict completed-parts body for multipart completion', () => {
    expect(
      v2CompleteUploadBodySchema.parse({ parts: [{ partNumber: 1, etag: 'etag-1' }] })
    ).toEqual({ parts: [{ partNumber: 1, etag: 'etag-1' }] })
    expect(v2CompleteUploadBodySchema.safeParse({ parts: [] }).success).toBe(false)
    expect(
      v2CompleteUploadBodySchema.safeParse({
        parts: [{ partNumber: 1 }],
        ignored: true,
      }).success
    ).toBe(false)
  })

  it('discriminates a PUT transfer from multipart geometry', () => {
    expect(
      v2UploadTransferSchema.parse({
        method: 'put',
        url: 'https://storage.example/upload',
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    ).toMatchObject({ method: 'put' })
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
})
