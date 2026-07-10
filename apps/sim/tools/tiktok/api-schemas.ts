import { z } from 'zod'

/** Raw user object returned by TikTok's user info API. */
export const tiktokApiUserSchema = z.object({
  open_id: z.string().optional(),
  union_id: z.string().optional(),
  avatar_url: z.string().optional(),
  avatar_large_url: z.string().optional(),
  display_name: z.string().optional(),
  bio_description: z.string().optional(),
  profile_deep_link: z.string().optional(),
  is_verified: z.boolean().optional(),
  username: z.string().optional(),
  follower_count: z.number().optional(),
  following_count: z.number().optional(),
  likes_count: z.number().optional(),
  video_count: z.number().optional(),
})

/** Data payload returned by TikTok's user info API. */
export const tiktokGetUserApiDataSchema = z.object({
  user: tiktokApiUserSchema.optional(),
})

/** Raw video object returned by TikTok's video APIs. */
export const tiktokApiVideoSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  cover_image_url: z.string().optional(),
  embed_link: z.string().optional(),
  embed_html: z.string().optional(),
  duration: z.number().optional(),
  create_time: z.number().optional(),
  share_url: z.string().optional(),
  video_description: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  view_count: z.number().optional(),
  like_count: z.number().optional(),
  comment_count: z.number().optional(),
  share_count: z.number().optional(),
})

/** Data payload returned by TikTok's list/query video APIs. */
export const tiktokVideosApiDataSchema = z.object({
  videos: z.array(tiktokApiVideoSchema).optional(),
  cursor: z.number().optional(),
  has_more: z.boolean().optional(),
})

/** Data payload returned by TikTok's creator info API. */
export const tiktokCreatorInfoApiDataSchema = z.object({
  creator_avatar_url: z.string().optional(),
  creator_username: z.string().optional(),
  creator_nickname: z.string().optional(),
  privacy_level_options: z.array(z.string()).optional(),
  comment_disabled: z.boolean().optional(),
  duet_disabled: z.boolean().optional(),
  stitch_disabled: z.boolean().optional(),
  max_video_post_duration_sec: z.number().optional(),
})

/** Data payload returned by TikTok's publish initialization APIs. */
export const tiktokPublishInitApiDataSchema = z.object({
  publish_id: z.string().optional(),
  upload_url: z.string().optional(),
})

/** Data payload returned by TikTok's post status API. */
export const tiktokPostStatusApiDataSchema = z.object({
  status: z.string().optional(),
  fail_reason: z.string().optional(),
  uploaded_bytes: z.number().optional(),
  downloaded_bytes: z.number().optional(),
})

export type TikTokApiVideo = z.infer<typeof tiktokApiVideoSchema>
