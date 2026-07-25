import { z } from 'zod'

/** Raw user object returned by TikTok's user info API. */
export const tiktokApiUserSchema = z.object({
  open_id: z.string(),
  union_id: z.string().optional(),
  avatar_url: z.string().optional(),
  avatar_large_url: z.string().optional(),
  display_name: z.string(),
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
  user: tiktokApiUserSchema,
})

/** Raw video object returned by TikTok's video APIs. */
export const tiktokApiVideoSchema = z.object({
  id: z.string(),
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

/** Data payload returned by TikTok's paginated video list API. */
export const tiktokListVideosApiDataSchema = z.object({
  videos: z.array(tiktokApiVideoSchema),
  cursor: z.number(),
  has_more: z.boolean(),
})

/** Data payload returned by TikTok's video query API. */
export const tiktokQueryVideosApiDataSchema = z.object({
  videos: z.array(tiktokApiVideoSchema),
})

/** Data payload returned by TikTok's publish initialization APIs. */
export const tiktokPublishInitApiDataSchema = z.object({
  publish_id: z.string(),
  upload_url: z.string(),
})

/** Data payload returned by TikTok's post status API. */
export const tiktokPostStatusApiDataSchema = z.object({
  status: z.string(),
  fail_reason: z.string().optional(),
  uploaded_bytes: z.number().optional(),
  downloaded_bytes: z.number().optional(),
})

export type TikTokApiVideo = z.infer<typeof tiktokApiVideoSchema>
