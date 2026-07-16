import { describe, expect, it } from 'vitest'
import { tiktokPublishVideoBodySchema } from '@/lib/api/contracts/tiktok-tools'

const file = {
  key: 'workspace/test/video.mp4',
  name: 'video.mp4',
  size: 1024,
  type: 'video/mp4',
}

describe('tiktokPublishVideoBodySchema', () => {
  it('accepts a draft upload body', () => {
    const parsed = tiktokPublishVideoBodySchema.safeParse({
      accessToken: 'token',
      file,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data).toEqual({ accessToken: 'token', file })
    }
  })

  it('accepts an explicit draft mode and strips it from the result', () => {
    const parsed = tiktokPublishVideoBodySchema.safeParse({
      accessToken: 'token',
      mode: 'draft',
      file,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data).toEqual({ accessToken: 'token', file })
    }
  })

  it('rejects legacy Direct Post mode instead of uploading as a draft', () => {
    const parsed = tiktokPublishVideoBodySchema.safeParse({
      accessToken: 'token',
      mode: 'direct',
      file,
      musicUsageConsent: 'accepted',
      postInfo: {
        privacy_level: 'SELF_ONLY',
        disable_duet: true,
        disable_stitch: true,
        disable_comment: true,
        brand_content_toggle: false,
      },
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a body without an access token', () => {
    expect(
      tiktokPublishVideoBodySchema.safeParse({
        file,
      }).success
    ).toBe(false)
  })

  it('rejects a body without a file', () => {
    expect(
      tiktokPublishVideoBodySchema.safeParse({
        accessToken: 'token',
      }).success
    ).toBe(false)
  })
})
