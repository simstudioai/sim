import { TikTokIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { TikTokResponse } from '@/tools/tiktok/types'

export const TikTokBlock: BlockConfig<TikTokResponse> = {
  type: 'tiktok',
  name: 'TikTok',
  description: 'Access TikTok user profiles and videos',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate TikTok into your workflow. Get user profile information including follower counts and video statistics. List and query videos with cover images, embed links, and metadata.',
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
  ],
  tools: {
    access: ['tiktok_get_user', 'tiktok_list_videos', 'tiktok_query_videos'],
    config: {
      tool: (inputs) => {
        const operation = inputs.operation || 'get_user'

        switch (operation) {
          case 'list_videos':
            return 'tiktok_list_videos'
          case 'query_videos':
            return 'tiktok_query_videos'
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
    cursor: { type: 'number', description: 'Cursor for next page' },
    hasMore: { type: 'boolean', description: 'Whether more videos are available' },
  },
}
