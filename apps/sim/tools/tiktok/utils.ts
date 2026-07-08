import type { TikTokVideo } from '@/tools/tiktok/types'

/**
 * Default fields requested from TikTok's `/v2/user/info/` endpoint, covering the
 * `user.info.basic`, `user.info.profile`, and `user.info.stats` scopes.
 * `avatar_url` and `avatar_large_url` feed the file-typed `avatarFile` output.
 */
export const TIKTOK_USER_FIELDS =
  'open_id,union_id,avatar_url,avatar_large_url,display_name,bio_description,profile_deep_link,is_verified,username,follower_count,following_count,likes_count,video_count'

/**
 * Fields requested from TikTok's `/v2/video/list/` and `/v2/video/query/` endpoints.
 * All are available under the `video.list` scope.
 */
export const TIKTOK_VIDEO_FIELDS =
  'id,title,cover_image_url,embed_link,duration,create_time,share_url,video_description,width,height,view_count,like_count,comment_count,share_count'

export function mapTikTokVideo(video: Record<string, unknown>): TikTokVideo {
  return {
    id: (video.id as string) ?? '',
    title: (video.title as string) ?? null,
    coverImageUrl: (video.cover_image_url as string) ?? null,
    embedLink: (video.embed_link as string) ?? null,
    duration: (video.duration as number) ?? null,
    createTime: (video.create_time as number) ?? null,
    shareUrl: (video.share_url as string) ?? null,
    videoDescription: (video.video_description as string) ?? null,
    width: (video.width as number) ?? null,
    height: (video.height as number) ?? null,
    viewCount: (video.view_count as number) ?? null,
    likeCount: (video.like_count as number) ?? null,
    commentCount: (video.comment_count as number) ?? null,
    shareCount: (video.share_count as number) ?? null,
  }
}

/**
 * Video/photo publish-init tools can hit TikTok directly (PULL_FROM_URL, calling
 * TikTok's own `/init/` endpoints) or an internal Sim route (FILE_UPLOAD, which
 * downloads the workflow file and performs the chunked PUT before responding).
 * The two paths return different envelopes, so responses are normalized here.
 */
export function parsePublishInitResponse(data: Record<string, unknown>): {
  success: boolean
  publishId: string
  error?: string
} {
  // Internal route shape: { success, output: { publishId }, error }
  if ('success' in data) {
    const success = Boolean(data.success)
    if (!success) {
      return { success: false, publishId: '', error: (data.error as string) || 'Failed to publish' }
    }
    const output = data.output as { publishId?: string } | undefined
    return { success: true, publishId: output?.publishId ?? '' }
  }

  // Direct TikTok `/init/` response shape: { data: { publish_id }, error: { code, message } }
  const error = data.error as { code?: string; message?: string } | undefined
  if (error?.code && error.code !== 'ok') {
    return { success: false, publishId: '', error: error.message || 'Failed to initiate post' }
  }

  const publishId = (data.data as { publish_id?: string } | undefined)?.publish_id
  if (!publishId) {
    return { success: false, publishId: '', error: 'No publish ID returned' }
  }

  return { success: true, publishId }
}
