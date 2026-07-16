import { describe, expect, it } from 'vitest'
import { tiktokGetPostStatusTool } from '@/tools/tiktok/get_post_status'

describe('TikTok Get Post Status OAuth scopes', () => {
  it("does not model TikTok's publish-or-upload authorization as all-of scopes", () => {
    expect(tiktokGetPostStatusTool.oauth).toEqual({
      required: true,
      provider: 'tiktok',
    })
  })
})
