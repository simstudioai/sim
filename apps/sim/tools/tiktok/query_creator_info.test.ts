/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { tiktokQueryCreatorInfoTool } from '@/tools/tiktok/query_creator_info'

describe('TikTok Query Creator Info', () => {
  it('exposes the temporary avatar as a composable file output', async () => {
    const response = Response.json({
      data: {
        creator_avatar_url: 'https://p16-sign.tiktokcdn-us.com/avatar.jpeg',
        creator_username: 'creator',
        creator_nickname: 'Creator',
        privacy_level_options: ['SELF_ONLY'],
        comment_disabled: true,
        duet_disabled: false,
        stitch_disabled: true,
        max_video_post_duration_sec: 180,
      },
      error: { code: 'ok' },
    })

    await expect(tiktokQueryCreatorInfoTool.transformResponse?.(response)).resolves.toMatchObject({
      success: true,
      output: {
        creatorAvatarUrl: 'https://p16-sign.tiktokcdn-us.com/avatar.jpeg',
        creatorAvatarFile: {
          name: 'creator-avatar.jpg',
          mimeType: 'image/jpeg',
          url: 'https://p16-sign.tiktokcdn-us.com/avatar.jpeg',
        },
        privacyLevelOptions: ['SELF_ONLY'],
      },
    })
    expect(tiktokQueryCreatorInfoTool.outputs?.creatorAvatarFile).toMatchObject({
      type: 'file',
      optional: true,
    })
    expect(tiktokQueryCreatorInfoTool.outputs?.creatorAvatarUrl?.description).toMatch(/two hours/i)
  })

  it('omits the file descriptor when TikTok returns an empty avatar URL', async () => {
    const response = Response.json({
      data: {
        creator_avatar_url: '',
        creator_username: 'creator',
        creator_nickname: 'Creator',
        privacy_level_options: ['SELF_ONLY'],
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: false,
        max_video_post_duration_sec: 180,
      },
      error: { code: 'ok' },
    })

    const result = await tiktokQueryCreatorInfoTool.transformResponse?.(response)

    expect(result?.success).toBe(true)
    expect(result?.output.creatorAvatarUrl).toBe('')
    expect(result?.output).not.toHaveProperty('creatorAvatarFile')
    expect(tiktokQueryCreatorInfoTool.outputs?.privacyLevelOptions?.items).toEqual({
      type: 'string',
      description: 'Privacy level currently available to the authenticated creator',
    })
  })
})
