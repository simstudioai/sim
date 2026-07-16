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
    expect(
      tiktokPublishVideoBodySchema.safeParse({
        accessToken: 'token',
        file,
      }).success
    ).toBe(true)
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
