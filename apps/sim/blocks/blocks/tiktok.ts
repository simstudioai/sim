import { TikTokIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { TikTokResponse } from '@/tools/tiktok/types'

export const TikTokBlock: BlockConfig<TikTokResponse> = {
  type: 'tiktok',
  name: 'TikTok',
  description: 'Access TikTok user profiles, videos, and publish content',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate TikTok into your workflow. Get user profile information including follower counts and video statistics. List and query videos with cover images, embed links, and metadata. Publish videos directly to TikTok from public URLs.',
  docsLink: 'https://docs.sim.ai/tools/tiktok',
  category: 'tools',
  bgColor: '#000000',
  icon: TikTokIcon,
  subBlocks: [
    // Operation selection
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get User Info', id: 'get_user' },
        { label: 'List Videos', id: 'list_videos' },
        { label: 'Query Videos', id: 'query_videos' },
        { label: 'Query Creator Info', id: 'query_creator_info' },
        { label: 'Direct Post Video', id: 'direct_post_video' },
        { label: 'Get Post Status', id: 'get_post_status' },
      ],
      value: () => 'get_user',
    },

    // TikTok OAuth Authentication
    {
      id: 'credential',
      title: 'TikTok Account',
      type: 'oauth-input',
      serviceId: 'tiktok',
      placeholder: 'Select TikTok account',
      required: true,
    },

    // Get User Info specific fields
    {
      id: 'fields',
      title: 'Fields',
      type: 'short-input',
      placeholder: 'open_id,display_name,avatar_url,follower_count,video_count',
      condition: {
        field: 'operation',
        value: 'get_user',
      },
    },

    // List Videos specific fields
    {
      id: 'maxCount',
      title: 'Max Count',
      type: 'short-input',
      placeholder: '20',
      condition: {
        field: 'operation',
        value: 'list_videos',
      },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      condition: {
        field: 'operation',
        value: 'list_videos',
      },
    },

    // Query Videos specific fields
    {
      id: 'videoIds',
      title: 'Video IDs',
      type: 'long-input',
      placeholder: 'Comma-separated video IDs (e.g., 7077642457847994444,7080217258529732386)',
      condition: {
        field: 'operation',
        value: 'query_videos',
      },
      required: {
        field: 'operation',
        value: 'query_videos',
      },
    },

    // Direct Post Video specific fields
    {
      id: 'videoUrl',
      title: 'Video URL',
      type: 'short-input',
      placeholder: 'https://example.com/video.mp4',
      condition: {
        field: 'operation',
        value: 'direct_post_video',
      },
      required: {
        field: 'operation',
        value: 'direct_post_video',
      },
    },
    {
      id: 'title',
      title: 'Caption',
      type: 'long-input',
      placeholder: 'Video caption with #hashtags and @mentions',
      condition: {
        field: 'operation',
        value: 'direct_post_video',
      },
    },
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
      value: () => 'PUBLIC_TO_EVERYONE',
      condition: {
        field: 'operation',
        value: 'direct_post_video',
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
      condition: {
        field: 'operation',
        value: 'direct_post_video',
      },
    },

    // Get Post Status specific fields
    {
      id: 'publishId',
      title: 'Publish ID',
      type: 'short-input',
      placeholder: 'v_pub_file~v2-1.123456789',
      condition: {
        field: 'operation',
        value: 'get_post_status',
      },
      required: {
        field: 'operation',
        value: 'get_post_status',
      },
    },
  ],
  tools: {
    access: [
      'tiktok_get_user',
      'tiktok_list_videos',
      'tiktok_query_videos',
      'tiktok_query_creator_info',
      'tiktok_direct_post_video',
      'tiktok_get_post_status',
    ],
    config: {
      tool: (inputs) => {
        const operation = inputs.operation || 'get_user'

        switch (operation) {
          case 'list_videos':
            return 'tiktok_list_videos'
          case 'query_videos':
            return 'tiktok_query_videos'
          case 'query_creator_info':
            return 'tiktok_query_creator_info'
          case 'direct_post_video':
            return 'tiktok_direct_post_video'
          case 'get_post_status':
            return 'tiktok_get_post_status'
          default:
            return 'tiktok_get_user'
        }
      },
      params: (inputs) => {
        const operation = inputs.operation || 'get_user'
        const { credential } = inputs

        switch (operation) {
          case 'get_user':
            return {
              accessToken: credential,
              ...(inputs.fields && { fields: inputs.fields }),
            }
          case 'list_videos':
            return {
              accessToken: credential,
              ...(inputs.maxCount && { maxCount: Number(inputs.maxCount) }),
              ...(inputs.cursor && { cursor: Number(inputs.cursor) }),
            }
          case 'query_videos':
            return {
              accessToken: credential,
              videoIds: inputs.videoIds
                ? inputs.videoIds.split(',').map((id: string) => id.trim())
                : [],
            }
          case 'query_creator_info':
            return {
              accessToken: credential,
            }
          case 'direct_post_video':
            return {
              accessToken: credential,
              videoUrl: inputs.videoUrl || '',
              privacyLevel: inputs.privacyLevel || 'PUBLIC_TO_EVERYONE',
              ...(inputs.title && { title: inputs.title }),
              ...(inputs.disableComment === 'true' && { disableComment: true }),
            }
          case 'get_post_status':
            return {
              accessToken: credential,
              publishId: inputs.publishId || '',
            }
          default:
            return {
              accessToken: credential,
            }
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'TikTok access token' },
    fields: { type: 'string', description: 'Comma-separated list of user fields to return' },
    maxCount: { type: 'number', description: 'Maximum number of videos to return (1-20)' },
    cursor: { type: 'number', description: 'Pagination cursor from previous response' },
    videoIds: { type: 'string', description: 'Comma-separated list of video IDs to query' },
    videoUrl: { type: 'string', description: 'Public URL of the video to post' },
    title: { type: 'string', description: 'Video caption/description' },
    privacyLevel: { type: 'string', description: 'Privacy level for the video' },
    disableComment: { type: 'string', description: 'Whether to disable comments' },
    publishId: { type: 'string', description: 'Publish ID to check status for' },
  },
  outputs: {
    // Get User outputs
    openId: { type: 'string', description: 'TikTok user ID' },
    displayName: { type: 'string', description: 'User display name' },
    avatarUrl: { type: 'string', description: 'Profile image URL' },
    bioDescription: { type: 'string', description: 'User bio' },
    followerCount: { type: 'number', description: 'Number of followers' },
    followingCount: { type: 'number', description: 'Number of accounts followed' },
    likesCount: { type: 'number', description: 'Total likes received' },
    videoCount: { type: 'number', description: 'Total public videos' },
    isVerified: { type: 'boolean', description: 'Whether account is verified' },
    // List/Query Videos outputs
    videos: { type: 'json', description: 'Array of video objects' },
    hasMore: { type: 'boolean', description: 'Whether more videos are available' },
    // Query Creator Info outputs
    creatorAvatarUrl: { type: 'string', description: 'Creator avatar URL' },
    creatorUsername: { type: 'string', description: 'Creator username' },
    creatorNickname: { type: 'string', description: 'Creator nickname' },
    privacyLevelOptions: { type: 'json', description: 'Available privacy levels for posting' },
    commentDisabled: { type: 'boolean', description: 'Whether comments are disabled by default' },
    duetDisabled: { type: 'boolean', description: 'Whether duets are disabled by default' },
    stitchDisabled: { type: 'boolean', description: 'Whether stitches are disabled by default' },
    maxVideoPostDurationSec: { type: 'number', description: 'Max video duration in seconds' },
    // Direct Post Video outputs
    publishId: { type: 'string', description: 'Publish ID for tracking post status' },
    // Get Post Status outputs
    status: {
      type: 'string',
      description: 'Post status (PROCESSING_DOWNLOAD, PUBLISH_COMPLETE, FAILED)',
    },
    failReason: { type: 'string', description: 'Reason for failure if status is FAILED' },
    publiclyAvailablePostId: {
      type: 'json',
      description: 'Array of public post IDs when published',
    },
  },
}
