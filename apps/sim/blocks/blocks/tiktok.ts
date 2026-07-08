import { TikTokIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { TikTokResponse } from '@/tools/tiktok/types'

const VIDEO_POST_OPERATIONS = ['tiktok_direct_post_video', 'tiktok_upload_video_draft']
const PHOTO_POST_OPERATIONS = ['tiktok_direct_post_photo', 'tiktok_upload_photo_draft']

export const TikTokBlock: BlockConfig<TikTokResponse> = {
  type: 'tiktok',
  name: 'TikTok',
  description: 'Access TikTok profiles and videos, and publish content',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate TikTok into your workflow. Get user profile information including follower counts and video statistics. List and query videos with cover images, embed links, and metadata. Publish videos and photos directly to TikTok (or send them to the inbox as drafts) from a public URL or a file uploaded in the workflow, then track post status.',
  docsLink: 'https://docs.sim.ai/integrations/tiktok',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  bgColor: '#000000',
  icon: TikTokIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get User Info', id: 'tiktok_get_user' },
        { label: 'List Videos', id: 'tiktok_list_videos' },
        { label: 'Query Videos', id: 'tiktok_query_videos' },
        { label: 'Query Creator Info', id: 'tiktok_query_creator_info' },
        { label: 'Direct Post Video', id: 'tiktok_direct_post_video' },
        { label: 'Upload Video Draft', id: 'tiktok_upload_video_draft' },
        { label: 'Direct Post Photo', id: 'tiktok_direct_post_photo' },
        { label: 'Upload Photo Draft', id: 'tiktok_upload_photo_draft' },
        { label: 'Get Post Status', id: 'tiktok_get_post_status' },
      ],
      value: () => 'tiktok_get_user',
    },

    // --- OAuth Credential ---
    {
      id: 'credential',
      title: 'TikTok Account',
      type: 'oauth-input',
      serviceId: 'tiktok',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      requiredScopes: getScopesForService('tiktok'),
      placeholder: 'Select TikTok account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'TikTok Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    // --- Get User Info ---
    {
      id: 'fields',
      title: 'Fields',
      type: 'short-input',
      placeholder: 'open_id,display_name,avatar_url,follower_count,video_count',
      description: 'Comma-separated list of user fields to return. Leave empty for all fields.',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tiktok_get_user' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of TikTok user info fields based on the user request, choosing only from: open_id, union_id, avatar_url, avatar_url_100, avatar_large_url, display_name, bio_description, profile_deep_link, is_verified, username, follower_count, following_count, likes_count, video_count. Return ONLY the comma-separated field names - no explanations, no extra text.',
        placeholder: 'Describe which profile fields you need',
      },
    },

    // --- List Videos ---
    {
      id: 'maxCount',
      title: 'Max Count',
      type: 'short-input',
      placeholder: '20',
      description: 'Maximum number of videos to return (1-20).',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tiktok_list_videos' },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tiktok_list_videos' },
    },

    // --- Query Videos ---
    {
      id: 'videoIds',
      title: 'Video IDs',
      type: 'long-input',
      placeholder: 'Comma-separated video IDs (e.g., 7077642457847994444,7080217258529732386)',
      condition: { field: 'operation', value: 'tiktok_query_videos' },
      required: { field: 'operation', value: 'tiktok_query_videos' },
    },

    // --- Video source (Direct Post Video / Upload Video Draft) ---
    {
      id: 'videoSource',
      title: 'Video Source',
      type: 'dropdown',
      options: [
        { label: 'Public URL', id: 'PULL_FROM_URL' },
        { label: 'Upload File', id: 'FILE_UPLOAD' },
      ],
      value: () => 'PULL_FROM_URL',
      condition: { field: 'operation', value: VIDEO_POST_OPERATIONS },
    },
    {
      id: 'videoUrl',
      title: 'Video URL',
      type: 'short-input',
      placeholder: 'https://example.com/video.mp4',
      description:
        'Public URL of the video. The domain/URL prefix must be verified in the TikTok developer portal.',
      condition: {
        field: 'operation',
        value: VIDEO_POST_OPERATIONS,
        and: { field: 'videoSource', value: 'PULL_FROM_URL' },
      },
      required: {
        field: 'operation',
        value: VIDEO_POST_OPERATIONS,
        and: { field: 'videoSource', value: 'PULL_FROM_URL' },
      },
    },
    {
      id: 'videoFile',
      title: 'Video File',
      type: 'file-upload',
      canonicalParamId: 'file',
      mode: 'basic',
      placeholder: 'Upload video',
      acceptedTypes: '.mp4,.mov,.webm',
      multiple: false,
      condition: {
        field: 'operation',
        value: VIDEO_POST_OPERATIONS,
        and: { field: 'videoSource', value: 'FILE_UPLOAD' },
      },
      required: {
        field: 'operation',
        value: VIDEO_POST_OPERATIONS,
        and: { field: 'videoSource', value: 'FILE_UPLOAD' },
      },
    },
    {
      id: 'videoFileRef',
      title: 'Video File',
      type: 'short-input',
      canonicalParamId: 'file',
      mode: 'advanced',
      placeholder: 'Reference a video from a previous block (e.g., <videogenerator1.videoFile>)',
      condition: {
        field: 'operation',
        value: VIDEO_POST_OPERATIONS,
        and: { field: 'videoSource', value: 'FILE_UPLOAD' },
      },
      required: {
        field: 'operation',
        value: VIDEO_POST_OPERATIONS,
        and: { field: 'videoSource', value: 'FILE_UPLOAD' },
      },
    },

    // --- Photo images (Direct Post Photo / Upload Photo Draft) ---
    {
      id: 'photoImages',
      title: 'Photo URLs',
      type: 'long-input',
      placeholder: 'One public image URL per line (up to 35, JPEG or WEBP only — no PNG)',
      description:
        'Public, verified-domain URLs of the images to post. Photos only support public URLs, not file upload.',
      condition: { field: 'operation', value: PHOTO_POST_OPERATIONS },
      required: { field: 'operation', value: PHOTO_POST_OPERATIONS },
    },
    {
      id: 'photoCoverIndex',
      title: 'Cover Photo Index',
      type: 'short-input',
      placeholder: '0',
      description: 'Index (starting from 0) of the photo to use as the cover.',
      mode: 'advanced',
      condition: { field: 'operation', value: PHOTO_POST_OPERATIONS },
    },

    // --- Shared caption/title (video + photo posts) ---
    {
      id: 'title',
      title: 'Title / Caption',
      type: 'long-input',
      placeholder: 'Caption with #hashtags and @mentions',
      description:
        'Caption or title. Max 2200 characters for videos, 90 characters for photo posts.',
      condition: {
        field: 'operation',
        value: [
          'tiktok_direct_post_video',
          'tiktok_direct_post_photo',
          'tiktok_upload_photo_draft',
        ],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Post description',
      description: 'Post description. Max 4000 characters. Photo posts only.',
      condition: { field: 'operation', value: PHOTO_POST_OPERATIONS },
    },

    // --- Privacy & interaction settings (Direct Post Video / Direct Post Photo) ---
    {
      id: 'privacyLevel',
      title: 'Privacy Level',
      type: 'dropdown',
      options: [
        { label: 'Public', id: 'PUBLIC_TO_EVERYONE' },
        { label: 'Friends', id: 'MUTUAL_FOLLOW_FRIENDS' },
        { label: 'Followers', id: 'FOLLOWER_OF_CREATOR' },
        { label: 'Only Me', id: 'SELF_ONLY' },
      ],
      value: () => 'SELF_ONLY',
      description:
        'Must match one of the privacyLevelOptions returned by Query Creator Info. Unaudited apps (including sandbox apps) are restricted to Only Me.',
      condition: {
        field: 'operation',
        value: ['tiktok_direct_post_video', 'tiktok_direct_post_photo'],
      },
      required: {
        field: 'operation',
        value: ['tiktok_direct_post_video', 'tiktok_direct_post_photo'],
      },
    },
    {
      id: 'disableComment',
      title: 'Disable Comments',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['tiktok_direct_post_video', 'tiktok_direct_post_photo'],
      },
    },
    {
      id: 'disableDuet',
      title: 'Disable Duet',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tiktok_direct_post_video' },
    },
    {
      id: 'disableStitch',
      title: 'Disable Stitch',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tiktok_direct_post_video' },
    },
    {
      id: 'videoCoverTimestampMs',
      title: 'Cover Timestamp (ms)',
      type: 'short-input',
      placeholder: '1000',
      description: 'Timestamp in milliseconds to use as the video cover image.',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tiktok_direct_post_video' },
    },
    {
      id: 'isAigc',
      title: 'AI-Generated Content',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tiktok_direct_post_video' },
    },
    {
      id: 'autoAddMusic',
      title: 'Auto-Add Music',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tiktok_direct_post_photo' },
    },
    {
      id: 'brandContentToggle',
      title: 'Paid Partnership',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      description:
        'Disclose this post as a paid partnership promoting a third-party business. Branded content cannot be posted with Only Me privacy.',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['tiktok_direct_post_video', 'tiktok_direct_post_photo'],
      },
    },
    {
      id: 'brandOrganicToggle',
      title: 'Promotes Own Business',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      description: "Disclose this post as promoting the creator's own business.",
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['tiktok_direct_post_video', 'tiktok_direct_post_photo'],
      },
    },

    // --- Get Post Status ---
    {
      id: 'publishId',
      title: 'Publish ID',
      type: 'short-input',
      placeholder: 'v_pub_file~v2-1.123456789',
      condition: { field: 'operation', value: 'tiktok_get_post_status' },
      required: { field: 'operation', value: 'tiktok_get_post_status' },
    },
  ],

  tools: {
    access: [
      'tiktok_get_user',
      'tiktok_list_videos',
      'tiktok_query_videos',
      'tiktok_query_creator_info',
      'tiktok_direct_post_video',
      'tiktok_upload_video_draft',
      'tiktok_direct_post_photo',
      'tiktok_upload_photo_draft',
      'tiktok_get_post_status',
    ],
    config: {
      tool: (params) => params.operation || 'tiktok_get_user',
      params: (params) => {
        const credential = params.oauthCredential
        const operation = params.operation || 'tiktok_get_user'
        const toBoolean = (value: unknown): boolean | undefined =>
          value === undefined || value === '' ? undefined : String(value).toLowerCase() === 'true'

        switch (operation) {
          case 'tiktok_get_user':
            return {
              credential,
              ...(params.fields && { fields: params.fields }),
            }
          case 'tiktok_list_videos':
            return {
              credential,
              ...(params.maxCount && { maxCount: Number(params.maxCount) }),
              ...(params.cursor && { cursor: Number(params.cursor) }),
            }
          case 'tiktok_query_videos':
            return {
              credential,
              videoIds: (params.videoIds || '')
                .split(',')
                .map((id: string) => id.trim())
                .filter(Boolean),
            }
          case 'tiktok_query_creator_info':
            return { credential }
          case 'tiktok_direct_post_video': {
            const file = normalizeFileInput(params.file, { single: true })
            return {
              credential,
              source: params.videoSource || 'PULL_FROM_URL',
              videoUrl: params.videoUrl,
              file,
              title: params.title,
              privacyLevel: params.privacyLevel || 'SELF_ONLY',
              disableDuet: toBoolean(params.disableDuet),
              disableStitch: toBoolean(params.disableStitch),
              disableComment: toBoolean(params.disableComment),
              ...(params.videoCoverTimestampMs && {
                videoCoverTimestampMs: Number(params.videoCoverTimestampMs),
              }),
              isAigc: toBoolean(params.isAigc),
              brandContentToggle: toBoolean(params.brandContentToggle),
              brandOrganicToggle: toBoolean(params.brandOrganicToggle),
            }
          }
          case 'tiktok_upload_video_draft': {
            const file = normalizeFileInput(params.file, { single: true })
            return {
              credential,
              source: params.videoSource || 'PULL_FROM_URL',
              videoUrl: params.videoUrl,
              file,
            }
          }
          case 'tiktok_direct_post_photo':
            return {
              credential,
              photoImages: (params.photoImages || '')
                .split('\n')
                .map((url: string) => url.trim())
                .filter(Boolean),
              ...(params.photoCoverIndex && { photoCoverIndex: Number(params.photoCoverIndex) }),
              title: params.title,
              description: params.description,
              privacyLevel: params.privacyLevel || 'SELF_ONLY',
              disableComment: toBoolean(params.disableComment),
              autoAddMusic: toBoolean(params.autoAddMusic),
              brandContentToggle: toBoolean(params.brandContentToggle),
              brandOrganicToggle: toBoolean(params.brandOrganicToggle),
            }
          case 'tiktok_upload_photo_draft':
            return {
              credential,
              photoImages: (params.photoImages || '')
                .split('\n')
                .map((url: string) => url.trim())
                .filter(Boolean),
              ...(params.photoCoverIndex && { photoCoverIndex: Number(params.photoCoverIndex) }),
              title: params.title,
              description: params.description,
            }
          case 'tiktok_get_post_status':
            return {
              credential,
              publishId: params.publishId,
            }
          default:
            return { credential }
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'TikTok account credential' },
    fields: { type: 'string', description: 'Comma-separated list of user fields to return' },
    maxCount: { type: 'number', description: 'Maximum number of videos to return (1-20)' },
    cursor: { type: 'number', description: 'Pagination cursor from previous response' },
    videoIds: { type: 'string', description: 'Comma-separated list of video IDs to query' },
    videoSource: {
      type: 'string',
      description: 'Video transfer method (PULL_FROM_URL/FILE_UPLOAD)',
    },
    videoUrl: { type: 'string', description: 'Public URL of the video' },
    file: {
      type: 'json',
      description: 'Video file to upload (uploaded file or reference from a previous block)',
    },
    photoImages: { type: 'string', description: 'Newline-separated public photo URLs' },
    photoCoverIndex: { type: 'number', description: 'Index of the photo to use as cover' },
    title: { type: 'string', description: 'Video/photo caption or title' },
    description: { type: 'string', description: 'Photo post description' },
    privacyLevel: { type: 'string', description: 'Privacy level for the post' },
    disableComment: { type: 'string', description: 'Whether to disable comments' },
    disableDuet: { type: 'string', description: 'Whether to disable duet' },
    disableStitch: { type: 'string', description: 'Whether to disable stitch' },
    videoCoverTimestampMs: { type: 'number', description: 'Video cover timestamp in ms' },
    isAigc: { type: 'string', description: 'Whether the video is AI-generated content' },
    autoAddMusic: { type: 'string', description: 'Whether to auto-add recommended music' },
    brandContentToggle: {
      type: 'string',
      description: 'Whether the post is a paid partnership promoting a third-party business',
    },
    brandOrganicToggle: {
      type: 'string',
      description: "Whether the post promotes the creator's own business",
    },
    publishId: { type: 'string', description: 'Publish ID to check status for' },
  },

  outputs: {
    // Get User Info
    openId: {
      type: 'string',
      description: 'Unique TikTok user ID for this application',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    unionId: {
      type: 'string',
      description: 'Unique TikTok user ID across all apps from the developer',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    displayName: {
      type: 'string',
      description: 'User display name',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    avatarUrl: {
      type: 'string',
      description: 'Profile image URL',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    avatarUrl100: {
      type: 'string',
      description: 'Profile image URL (100x100)',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    avatarLargeUrl: {
      type: 'string',
      description: 'Profile image URL (large)',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    bioDescription: {
      type: 'string',
      description: 'User bio description',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    profileDeepLink: {
      type: 'string',
      description: 'Deep link to the user TikTok profile',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    isVerified: {
      type: 'boolean',
      description: 'Whether the account is verified',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    username: {
      type: 'string',
      description: 'TikTok username',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    followerCount: {
      type: 'number',
      description: 'Number of followers',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    followingCount: {
      type: 'number',
      description: 'Number of accounts followed',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    likesCount: {
      type: 'number',
      description: 'Total likes received across all videos',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    videoCount: {
      type: 'number',
      description: 'Total number of public videos',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },
    avatarFile: {
      type: 'file',
      description:
        'Downloadable copy of the profile avatar image, stored as a workflow file so it can be chained into file-consuming blocks (e.g. attached to an email).',
      condition: { field: 'operation', value: 'tiktok_get_user' },
    },

    // List/Query Videos
    videos: {
      type: 'json',
      description:
        'Array of video objects (id, title, coverImageUrl, embedLink, duration, createTime, shareUrl, videoDescription, width, height, viewCount, likeCount, commentCount, shareCount)',
      condition: { field: 'operation', value: ['tiktok_list_videos', 'tiktok_query_videos'] },
    },
    cursor: {
      type: 'number',
      description: 'Pagination cursor for fetching the next page',
      condition: { field: 'operation', value: 'tiktok_list_videos' },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more videos are available',
      condition: { field: 'operation', value: 'tiktok_list_videos' },
    },

    // Query Creator Info
    creatorAvatarUrl: {
      type: 'string',
      description: 'URL of the creator avatar',
      condition: { field: 'operation', value: 'tiktok_query_creator_info' },
    },
    creatorUsername: {
      type: 'string',
      description: 'TikTok username of the creator',
      condition: { field: 'operation', value: 'tiktok_query_creator_info' },
    },
    creatorNickname: {
      type: 'string',
      description: 'Display name/nickname of the creator',
      condition: { field: 'operation', value: 'tiktok_query_creator_info' },
    },
    privacyLevelOptions: {
      type: 'json',
      description: 'Available privacy levels for posting (array of strings)',
      condition: { field: 'operation', value: 'tiktok_query_creator_info' },
    },
    commentDisabled: {
      type: 'boolean',
      description: 'Whether the creator disabled comments by default',
      condition: { field: 'operation', value: 'tiktok_query_creator_info' },
    },
    duetDisabled: {
      type: 'boolean',
      description: 'Whether the creator disabled duets by default',
      condition: { field: 'operation', value: 'tiktok_query_creator_info' },
    },
    stitchDisabled: {
      type: 'boolean',
      description: 'Whether the creator disabled stitches by default',
      condition: { field: 'operation', value: 'tiktok_query_creator_info' },
    },
    maxVideoPostDurationSec: {
      type: 'number',
      description: 'Maximum allowed video duration in seconds',
      condition: { field: 'operation', value: 'tiktok_query_creator_info' },
    },

    // Direct Post / Upload Draft (video and photo)
    publishId: {
      type: 'string',
      description: 'Publish ID for tracking post status',
      condition: {
        field: 'operation',
        value: [...VIDEO_POST_OPERATIONS, ...PHOTO_POST_OPERATIONS],
      },
    },

    // Get Post Status
    status: {
      type: 'string',
      description:
        'Post status: PROCESSING_UPLOAD/PROCESSING_DOWNLOAD, SEND_TO_USER_INBOX, PUBLISH_COMPLETE, or FAILED',
      condition: { field: 'operation', value: 'tiktok_get_post_status' },
    },
    failReason: {
      type: 'string',
      description: 'Reason for failure if status is FAILED',
      condition: { field: 'operation', value: 'tiktok_get_post_status' },
    },
    publiclyAvailablePostId: {
      type: 'json',
      description: 'Array of public post IDs once the content is published',
      condition: { field: 'operation', value: 'tiktok_get_post_status' },
    },
  },
}

export const TikTokBlockMeta = {
  tags: ['marketing', 'content-management'],
  url: 'https://www.tiktok.com',
  templates: [
    {
      icon: TikTokIcon,
      title: 'AI video auto-publisher',
      prompt:
        'Build a workflow that takes a generated video file and publishes it directly to TikTok with an AI-written caption, then checks the post status until it completes.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: TikTokIcon,
      title: 'TikTok content calendar scheduler',
      prompt:
        'Create a scheduled workflow that reads the next due row from a Tables-based content calendar and publishes the matching video or photo to TikTok at the right time.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: TikTokIcon,
      title: 'TikTok performance reporter',
      prompt:
        'Build a workflow that lists recent TikTok videos, summarizes view and engagement trends with an agent, and posts the digest to Slack every week.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TikTokIcon,
      title: 'TikTok draft review pipeline',
      prompt:
        'Create a workflow that uploads a new video to a TikTok inbox draft for review, then notifies the marketing team on Slack to approve and post it from the TikTok app.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['marketing', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'publish-video-to-tiktok',
      description: 'Publish a video directly to TikTok from a public URL or an uploaded file.',
      content:
        '# Publish a Video to TikTok\n\nPost a video straight to a connected TikTok account.\n\n## Steps\n1. Use the Direct Post Video operation with a connected TikTok Account.\n2. Before the first post, run Query Creator Info to confirm posting permissions and see the allowed privacy levels — sandbox/unaudited apps are restricted to Only Me.\n3. Choose the Video Source: Public URL (the domain must be verified in the TikTok developer portal) or Upload File (a file produced earlier in the workflow).\n4. Set the Title/Caption with hashtags and mentions, and pick a Privacy Level from the options Query Creator Info returned.\n5. Use the Get Post Status operation with the returned Publish ID to confirm the post completed.\n\n## Output\nReturn the Publish ID and the final status (PUBLISH_COMPLETE or FAILED with a reason).',
    },
    {
      name: 'send-video-draft-to-inbox',
      description: "Send a video to the user's TikTok inbox for manual review before posting.",
      content:
        "# Send a TikTok Video Draft\n\nDeliver a video to the connected account's TikTok inbox so a human can review, edit, and publish it from the app.\n\n## Steps\n1. Use the Upload Video Draft operation with a connected TikTok Account.\n2. Choose the Video Source: Public URL or Upload File.\n3. Submit the draft — no caption or privacy level is set here, since the user finishes the post manually in the TikTok app.\n4. Use Get Post Status with the returned Publish ID to see when the user has acted on the inbox notification (SEND_TO_USER_INBOX until they do).\n\n## Output\nReturn the Publish ID so the draft's status can be tracked or referenced later.",
    },
    {
      name: 'publish-photo-carousel',
      description: 'Publish a set of photos to TikTok as a photo carousel post.',
      content:
        '# Publish a Photo Carousel to TikTok\n\nPost a carousel of images to a connected TikTok account. Photos only support public URLs (no file upload).\n\n## Steps\n1. Run Query Creator Info first to confirm the account can post and to read the allowed privacy levels.\n2. Use the Direct Post Photo operation with a connected TikTok Account.\n3. Provide Photo URLs, one public JPEG or WEBP URL per line (PNG is rejected), up to 35 images.\n4. Set a Title (max 90 characters), an optional Description (max 4000 characters), the Cover Photo Index, and a Privacy Level.\n5. Check progress with Get Post Status using the returned Publish ID.\n\n## Output\nReturn the Publish ID and the final status of the photo post.',
    },
    {
      name: 'check-tiktok-post-status',
      description: 'Poll the status of a TikTok post or draft until it completes or fails.',
      content:
        '# Check TikTok Post Status\n\nTrack the outcome of a post or draft submitted with any TikTok publish operation.\n\n## Steps\n1. Capture the Publish ID returned by Direct Post Video, Upload Video Draft, Direct Post Photo, or Upload Photo Draft.\n2. Call Get Post Status with that Publish ID.\n3. Branch on the returned status: PROCESSING_UPLOAD/PROCESSING_DOWNLOAD means still in progress, SEND_TO_USER_INBOX means a draft is waiting on the user, PUBLISH_COMPLETE means it succeeded, and FAILED means it did not (read failReason for why).\n4. Repeat on a delay for in-progress statuses until a terminal state is reached.\n\n## Output\nReturn the final status, failReason (if any), and the publiclyAvailablePostId once published.',
    },
    {
      name: 'summarize-tiktok-video-performance',
      description: "List a creator's recent TikTok videos and summarize engagement for reporting.",
      content:
        "# Summarize TikTok Video Performance\n\nPull a creator's recent videos and turn the metadata into a readable report.\n\n## Steps\n1. Use List Videos with a connected TikTok Account to fetch recent videos (paginate with the Cursor if more than one page is needed).\n2. For specific videos already known by ID, use Query Videos instead to refresh their metadata.\n3. Ask an agent to summarize the results — highlight top performers by duration/engagement signals available in the metadata and note any patterns.\n4. Optionally use Get User Info alongside this to report overall follower and like counts.\n\n## Output\nA structured summary or table of videos with their titles, share URLs, and key metadata, suitable for posting to a report or chat.",
    },
  ],
} as const satisfies BlockMeta
