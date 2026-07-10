import { describe, expect, it } from 'vitest'
import { tiktokPublishVideoBodySchema } from '@/lib/api/contracts/tiktok-tools'

const file = {
  key: 'workspace/test/video.mp4',
  name: 'video.mp4',
  size: 1024,
  type: 'video/mp4',
}

describe('tiktokPublishVideoBodySchema', () => {
  it('accepts a draft without direct-post metadata', () => {
    expect(
      tiktokPublishVideoBodySchema.safeParse({
        accessToken: 'token',
        mode: 'draft',
        file,
      }).success
    ).toBe(true)
  })

  it('requires direct-post privacy and commercial-content disclosure', () => {
    expect(
      tiktokPublishVideoBodySchema.safeParse({
        accessToken: 'token',
        mode: 'direct',
        file,
        postInfo: { privacy_level: 'SELF_ONLY' },
      }).success
    ).toBe(false)
  })

  it('accepts documented direct-post metadata', () => {
    expect(
      tiktokPublishVideoBodySchema.safeParse({
        accessToken: 'token',
        mode: 'direct',
        file,
        musicUsageConsent: 'accepted',
        postInfo: {
          title: 'A test video',
          privacy_level: 'SELF_ONLY',
          disable_duet: true,
          disable_stitch: true,
          disable_comment: true,
          brand_content_toggle: false,
        },
      }).success
    ).toBe(true)
  })

  it('rejects direct posting without explicit music usage consent', () => {
    expect(
      tiktokPublishVideoBodySchema.safeParse({
        accessToken: 'token',
        mode: 'direct',
        file,
        postInfo: {
          privacy_level: 'SELF_ONLY',
          disable_duet: true,
          disable_stitch: true,
          disable_comment: true,
          brand_content_toggle: false,
        },
      }).success
    ).toBe(false)
  })

  it('rejects an undocumented privacy value', () => {
    expect(
      tiktokPublishVideoBodySchema.safeParse({
        accessToken: 'token',
        mode: 'direct',
        file,
        musicUsageConsent: 'accepted',
        postInfo: {
          privacy_level: 'PRIVATE',
          disable_duet: true,
          disable_stitch: true,
          disable_comment: true,
          brand_content_toggle: false,
        },
      }).success
    ).toBe(false)
  })
})
