/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { tiktokDirectPostVideoTool } from '@/tools/tiktok/direct_post_video'
import type { TikTokDirectPostVideoParams } from '@/tools/tiktok/types'

describe('tiktokDirectPostVideoTool', () => {
  it('fails closed until one-use human approval is supported', () => {
    const params = {
      accessToken: 'token',
      brandContentToggle: false,
      disableComment: false,
      disableDuet: false,
      disableStitch: false,
      file: {
        id: 'file-1',
        key: 'workspace/workspace-1/file-1',
        name: 'video.mp4',
        size: 1024,
        type: 'video/mp4',
        url: '/api/files/serve?key=workspace%2Fworkspace-1%2Ffile-1',
      },
      musicUsageConsent: 'accepted',
      privacyLevel: 'SELF_ONLY',
    } satisfies TikTokDirectPostVideoParams

    expect(() => tiktokDirectPostVideoTool.request.body?.(params)).toThrow(
      'TikTok Direct Post is unavailable'
    )
  })
})
