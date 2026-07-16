import { describe, expect, it } from 'vitest'
import { tiktokUploadVideoDraftBodySchema } from '@/lib/api/contracts/tiktok-tools'

const file = {
  key: 'workspace/test/video.mp4',
  name: 'video.mp4',
  size: 1024,
  type: 'video/mp4',
}

describe('tiktokUploadVideoDraftBodySchema', () => {
  it('accepts a draft upload body', () => {
    const parsed = tiktokUploadVideoDraftBodySchema.safeParse({
      accessToken: 'token',
      file,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data).toEqual({ accessToken: 'token', file })
    }
  })

  it('rejects a body without an access token', () => {
    expect(
      tiktokUploadVideoDraftBodySchema.safeParse({
        file,
      }).success
    ).toBe(false)
  })

  it('rejects a body without a file', () => {
    expect(
      tiktokUploadVideoDraftBodySchema.safeParse({
        accessToken: 'token',
      }).success
    ).toBe(false)
  })
})
