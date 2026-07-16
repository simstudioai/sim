import { TikTokIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { TikTokResponse } from '@/tools/tiktok/types'
import { getTrigger } from '@/triggers'

const VIDEO_UPLOAD_OPERATIONS = ['tiktok_upload_video_draft']
const TIKTOK_TOOL_IDS = new Set([
  'tiktok_get_user',
  'tiktok_list_videos',
  'tiktok_query_videos',
  'tiktok_query_creator_info',
  'tiktok_upload_video_draft',
  'tiktok_get_post_status',
])
const TIKTOK_OPERATION_INPUT_KEYS = [
  'fields',
  'maxCount',
  'cursor',
  'videoIds',
  'file',
  'publishId',
] as const

export const TikTokBlock: BlockConfig<TikTokResponse> = {
  type: 'tiktok',
  name: 'TikTok',
  description: 'Access TikTok profiles and videos, and upload inbox drafts',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate TikTok into your workflow. Get user profile information including follower counts and video statistics. List and query videos with cover images, embed links, and metadata. Send uploaded videos to the TikTok inbox as drafts for human review and publishing, then track post status.',
  docsLink: 'https://docs.sim.ai/integrations/tiktok',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  bgColor: '#000000',
  icon: TikTokIcon,
  triggerAllowed: true,
  hideFromToolbar: false,

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
        { label: 'Upload Video Draft', id: 'tiktok_upload_video_draft' },
        { label: 'Get Post Status', id: 'tiktok_get_post_status' },
      ],
      value: () => 'tiktok_get_user',
    },

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
          'Generate a comma-separated list of TikTok user info fields based on the user request, choosing only from: open_id, union_id, avatar_url, avatar_large_url, display_name, bio_description, profile_deep_link, is_verified, username, follower_count, following_count, likes_count, video_count. Return ONLY the comma-separated field names - no explanations, no extra text.',
        placeholder: 'Describe which profile fields you need',
      },
    },

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

    {
      id: 'videoIds',
      title: 'Video IDs',
      type: 'long-input',
      placeholder: 'One video ID per line or comma-separated (e.g., 7077642457847994444)',
      condition: { field: 'operation', value: 'tiktok_query_videos' },
      required: { field: 'operation', value: 'tiktok_query_videos' },
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
      maxSize: 250,
      description: 'MP4, MOV, or WebM video up to 250 MB.',
      condition: { field: 'operation', value: VIDEO_UPLOAD_OPERATIONS },
      required: { field: 'operation', value: VIDEO_UPLOAD_OPERATIONS },
    },
    {
      id: 'videoFileRef',
      title: 'Video File',
      type: 'short-input',
      canonicalParamId: 'file',
      mode: 'advanced',
      placeholder: 'Reference a video from a previous block',
      condition: { field: 'operation', value: VIDEO_UPLOAD_OPERATIONS },
      required: { field: 'operation', value: VIDEO_UPLOAD_OPERATIONS },
    },

    {
      id: 'publishId',
      title: 'Publish ID',
      type: 'short-input',
      placeholder: 'v_pub_file~v2-1.123456789',
      condition: { field: 'operation', value: 'tiktok_get_post_status' },
      required: { field: 'operation', value: 'tiktok_get_post_status' },
    },

    ...getTrigger('tiktok_post_publish_complete').subBlocks,
    ...getTrigger('tiktok_post_publish_failed').subBlocks,
    ...getTrigger('tiktok_post_inbox_delivered').subBlocks,
    ...getTrigger('tiktok_post_publicly_available').subBlocks,
    ...getTrigger('tiktok_post_no_longer_public').subBlocks,
    ...getTrigger('tiktok_authorization_removed').subBlocks,
  ],

  triggers: {
    enabled: true,
    available: [
      'tiktok_post_publish_complete',
      'tiktok_post_publish_failed',
      'tiktok_post_inbox_delivered',
      'tiktok_post_publicly_available',
      'tiktok_post_no_longer_public',
      'tiktok_authorization_removed',
    ],
  },

  tools: {
    access: [
      'tiktok_get_user',
      'tiktok_list_videos',
      'tiktok_query_videos',
      'tiktok_query_creator_info',
      'tiktok_upload_video_draft',
      'tiktok_get_post_status',
    ],
    config: {
      tool: (params) => {
        const operation = params.operation || 'tiktok_get_user'
        if (!TIKTOK_TOOL_IDS.has(operation)) {
          throw new Error(`Unsupported TikTok operation: ${operation}`)
        }
        return operation
      },
      params: (params) => {
        const operation = params.operation || 'tiktok_get_user'
        const result: Record<string, unknown> = {}
        for (const key of TIKTOK_OPERATION_INPUT_KEYS) {
          result[key] = undefined
        }

        switch (operation) {
          case 'tiktok_get_user':
            if (params.fields) result.fields = params.fields
            break
          case 'tiktok_list_videos':
            if (params.maxCount) result.maxCount = Number(params.maxCount)
            if (params.cursor !== undefined && params.cursor !== '') {
              result.cursor = Number(params.cursor)
            }
            break
          case 'tiktok_query_videos':
            result.videoIds = (params.videoIds || '')
              .split(/[,\n]+/)
              .map((id: string) => id.trim())
              .filter(Boolean)
            break
          case 'tiktok_query_creator_info':
            break
          case 'tiktok_upload_video_draft': {
            result.file = normalizeFileInput(params.file, { single: true })
            break
          }
          case 'tiktok_get_post_status':
            result.publishId = params.publishId
            break
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'TikTok account credential' },
    fields: { type: 'string', description: 'Comma-separated list of user fields to return' },
    maxCount: { type: 'number', description: 'Maximum number of videos to return (1-20)' },
    cursor: { type: 'number', description: 'Pagination cursor from previous response' },
    videoIds: {
      type: 'string',
      description: 'List of video IDs to query, one per line or comma-separated',
    },
    file: {
      type: 'json',
      description: 'Video file to upload (uploaded file or reference from a previous block)',
    },
    publishId: { type: 'string', description: 'Publish ID to check status for' },
  },

  outputs: {
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

    videos: {
      type: 'array',
      description:
        'Video objects with metadata and provider cover URLs. Cover URLs expire after six hours and are not original-video downloads.',
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

    creatorAvatarUrl: {
      type: 'string',
      description: 'Provider URL of the creator avatar; expires after two hours',
      condition: { field: 'operation', value: 'tiktok_query_creator_info' },
    },
    creatorAvatarFile: {
      type: 'file',
      description:
        'Canonical workflow file containing the creator avatar, suitable for downstream attachments',
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
      type: 'array',
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

    publishId: {
      type: 'string',
      description: 'Publish ID for tracking post status',
      condition: {
        field: 'operation',
        value: VIDEO_UPLOAD_OPERATIONS,
      },
    },

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
      type: 'array',
      description: 'Array of public post IDs once the content is published',
      condition: { field: 'operation', value: 'tiktok_get_post_status' },
    },
    uploadedBytes: {
      type: 'number',
      description: 'Number of video bytes TikTok has received for a file upload',
      condition: { field: 'operation', value: 'tiktok_get_post_status' },
    },
    downloadedBytes: {
      type: 'number',
      description: 'Number of video bytes TikTok reports as downloaded',
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
      title: 'TikTok content calendar drafts',
      prompt:
        'Create a scheduled workflow that reads the next due row from a Tables-based content calendar, uploads the matching video to the creator’s TikTok inbox as a draft, and notifies them to review and publish it in TikTok.',
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
      name: 'send-video-draft-to-inbox',
      description: "Send a video to the user's TikTok inbox for manual review before posting.",
      content:
        "# Send a TikTok Video Draft\n\nDeliver a video to the connected account's TikTok inbox so a human can review, edit, and publish it from the app.\n\n## Steps\n1. Use the Upload Video Draft operation with a connected TikTok Account.\n2. Provide a Video File: upload one, or reference a file from a previous block.\n3. Submit the draft — no caption or privacy level is set here, since the user finishes the post manually in the TikTok app.\n4. Use Get Post Status with the returned Publish ID to see when the user has acted on the inbox notification (SEND_TO_USER_INBOX until they do).\n\n## Output\nReturn the Publish ID so the draft's status can be tracked or referenced later.",
    },
    {
      name: 'check-tiktok-post-status',
      description: 'Poll the status of a TikTok inbox draft until it completes or fails.',
      content:
        '# Check TikTok Draft Status\n\nTrack the outcome of a video submitted to the TikTok inbox for human review.\n\n## Steps\n1. Capture the Publish ID returned by Upload Video Draft.\n2. Call Get Post Status with that Publish ID.\n3. Branch on the returned status: PROCESSING_UPLOAD/PROCESSING_DOWNLOAD means still in progress, SEND_TO_USER_INBOX means the draft is waiting on the user, PUBLISH_COMPLETE means the user published it, and FAILED means it did not complete (read failReason for why).\n4. Repeat on a delay for in-progress statuses until a terminal state is reached.\n\n## Output\nReturn the final status, failReason (if any), and the publiclyAvailablePostId once published.',
    },
    {
      name: 'summarize-tiktok-video-performance',
      description: "List a creator's recent TikTok videos and summarize engagement for reporting.",
      content:
        "# Summarize TikTok Video Performance\n\nPull a creator's recent videos and turn the metadata into a readable report.\n\n## Steps\n1. Use List Videos with a connected TikTok Account to fetch recent videos (paginate with the Cursor if more than one page is needed).\n2. For specific videos already known by ID, use Query Videos instead to refresh their metadata.\n3. Ask an agent to summarize the results — highlight top performers by duration/engagement signals available in the metadata and note any patterns.\n4. Optionally use Get User Info alongside this to report overall follower and like counts.\n\n## Output\nA structured summary or table of videos with their titles, share URLs, and key metadata, suitable for posting to a report or chat.",
    },
  ],
} as const satisfies BlockMeta
