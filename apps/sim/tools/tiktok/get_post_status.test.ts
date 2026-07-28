import { describe, expect, it } from 'vitest'
import { tiktokGetPostStatusTool } from '@/tools/tiktok/get_post_status'

describe('TikTok Get Post Status OAuth scopes', () => {
  it('requires the draft-upload scope used by the supported posting flow', () => {
    expect(tiktokGetPostStatusTool.oauth).toEqual({
      required: true,
      provider: 'tiktok',
      requiredScopes: ['video.upload'],
    })
  })
})
