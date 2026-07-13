import { describe, expect, it } from 'vitest'
import {
  tiktokCreatorInfoApiDataSchema,
  tiktokGetUserApiDataSchema,
  tiktokListVideosApiDataSchema,
  tiktokPostStatusApiDataSchema,
  tiktokPublishInitApiDataSchema,
  tiktokQueryVideosApiDataSchema,
} from '@/tools/tiktok/api-schemas'

describe('TikTok documented response schemas', () => {
  it('requires stable user identity fields', () => {
    expect(
      tiktokGetUserApiDataSchema.safeParse({
        user: { open_id: 'user-1', display_name: 'Creator' },
      }).success
    ).toBe(true)
    expect(
      tiktokGetUserApiDataSchema.safeParse({
        user: { display_name: 'Creator' },
      }).success
    ).toBe(false)
  })

  it('requires pagination only on list-video payloads and always requires video IDs', () => {
    const videos = [{ id: 'video-1' }]
    expect(
      tiktokListVideosApiDataSchema.safeParse({ videos, cursor: 123, has_more: false }).success
    ).toBe(true)
    expect(tiktokListVideosApiDataSchema.safeParse({ videos }).success).toBe(false)
    expect(tiktokQueryVideosApiDataSchema.safeParse({ videos }).success).toBe(true)
    expect(tiktokQueryVideosApiDataSchema.safeParse({ videos: [{}] }).success).toBe(false)
  })

  it('requires the documented creator capability fields', () => {
    const complete = {
      creator_avatar_url: 'https://example.com/avatar',
      creator_username: 'creator',
      creator_nickname: 'Creator',
      privacy_level_options: ['SELF_ONLY'],
      comment_disabled: false,
      duet_disabled: false,
      stitch_disabled: false,
      max_video_post_duration_sec: 180,
    }

    expect(tiktokCreatorInfoApiDataSchema.safeParse(complete).success).toBe(true)
    const { privacy_level_options: _privacyLevelOptions, ...incomplete } = complete
    expect(tiktokCreatorInfoApiDataSchema.safeParse(incomplete).success).toBe(false)
  })

  it('requires publish initialization identifiers and post status', () => {
    expect(
      tiktokPublishInitApiDataSchema.safeParse({
        publish_id: 'publish-1',
        upload_url: 'https://upload.example/video',
      }).success
    ).toBe(true)
    expect(tiktokPublishInitApiDataSchema.safeParse({ publish_id: 'publish-1' }).success).toBe(
      false
    )
    expect(tiktokPostStatusApiDataSchema.safeParse({ status: 'PROCESSING_UPLOAD' }).success).toBe(
      true
    )
    expect(tiktokPostStatusApiDataSchema.safeParse({}).success).toBe(false)
  })
})
