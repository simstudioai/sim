import { InstagramIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { InstagramResponse } from '@/tools/instagram/types'

/**
 * Resolves a canonical media input to either an uploaded file object or a plain URL string.
 * `normalizeFileInput` only recognizes file objects (or JSON-serialized file references) — a raw
 * HTTPS URL typed into the advanced field is passed through as a string.
 */
function resolveSingleMediaInput(value: unknown): object | string | undefined {
  const file = normalizeFileInput(value, { single: true })
  if (file) return file
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return undefined
}

/**
 * Resolves carousel media to a file array, or a legacy comma-separated URL string.
 */
function resolveCarouselMediaInput(value: unknown): object[] | string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const files = normalizeFileInput(parsed)
      if (files) return files
    } catch {
      return trimmed
    }
    return trimmed
  }
  const files = normalizeFileInput(value)
  if (files) return files
  return undefined
}

const IG_USER_ID_OPS = [
  'instagram_list_media',
  'instagram_list_stories',
  'instagram_publish_image',
  'instagram_publish_video',
  'instagram_publish_reel',
  'instagram_publish_story',
  'instagram_publish_carousel',
  'instagram_get_publishing_limit',
  'instagram_private_reply',
  'instagram_list_conversations',
  'instagram_send_text_message',
  'instagram_get_account_insights',
]

const OPERATION_PARAM_KEYS: Record<string, readonly string[]> = {
  instagram_get_profile: [],
  instagram_list_media: ['igUserId', 'limit', 'after'],
  instagram_get_media: ['mediaId'],
  instagram_download_media: ['mediaId', 'filename'],
  instagram_list_stories: ['igUserId', 'limit', 'after'],
  instagram_publish_image: ['igUserId', 'caption', 'altText', 'isAiGenerated'],
  instagram_publish_video: ['igUserId', 'caption'],
  instagram_publish_reel: ['igUserId', 'caption', 'shareToFeed', 'thumbOffset'],
  instagram_publish_story: ['igUserId'],
  instagram_publish_carousel: ['igUserId', 'caption'],
  instagram_get_container_status: ['containerId'],
  instagram_get_publishing_limit: ['igUserId'],
  instagram_list_comments: ['mediaId', 'limit', 'after'],
  instagram_reply_to_comment: ['commentId', 'message'],
  instagram_hide_comment: ['commentId', 'hide'],
  instagram_delete_comment: ['commentId'],
  instagram_set_comments_enabled: ['mediaId', 'commentEnabled'],
  instagram_private_reply: ['igUserId', 'commentId', 'message'],
  instagram_list_conversations: ['igUserId', 'limit', 'after'],
  instagram_get_conversation_messages: ['conversationId', 'limit', 'after'],
  instagram_get_message: ['messageId'],
  instagram_send_text_message: ['igUserId', 'recipientId', 'message'],
  instagram_get_account_insights: [
    'igUserId',
    'metrics',
    'period',
    'since',
    'until',
    'metricType',
    'breakdown',
    'timeframe',
  ],
  instagram_get_media_insights: ['mediaId', 'metrics'],
}

const INSTAGRAM_TOOL_IDS = new Set(Object.keys(OPERATION_PARAM_KEYS))
const INSTAGRAM_OPERATION_INPUT_KEYS = new Set([
  'image',
  'video',
  'cover',
  'media',
  'carouselMedia',
  ...Object.values(OPERATION_PARAM_KEYS).flat(),
])

const NUMERIC_PARAM_KEYS = new Set(['limit', 'thumbOffset'])
const BOOLEAN_PARAM_KEYS = new Set(['hide', 'commentEnabled', 'shareToFeed', 'isAiGenerated'])

export const InstagramBlock: BlockConfig<InstagramResponse> = {
  type: 'instagram',
  name: 'Instagram',
  description: 'Publish and download content, moderate comments, and manage Instagram DMs',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Instagram into workflows. Publish and download images, videos, Reels, stories, and carousels as canonical User Files; moderate comments; send DMs; and pull account or media insights.',
  docsLink: 'https://docs.sim.ai/integrations/instagram',
  category: 'tools',
  integrationType: IntegrationType.Marketing,
  bgColor: 'radial-gradient(circle at 28% 96%, #fa8f21 9%, #d82d7e 55%, #8c3aaa 100%)',
  iconColor: '#E4405F',
  icon: InstagramIcon,
  hideFromToolbar: true,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Profile', id: 'instagram_get_profile' },
        { label: 'List Media', id: 'instagram_list_media' },
        { label: 'Get Media', id: 'instagram_get_media' },
        { label: 'Download Media', id: 'instagram_download_media' },
        { label: 'List Stories', id: 'instagram_list_stories' },
        { label: 'Publish Image', id: 'instagram_publish_image' },
        { label: 'Publish Video', id: 'instagram_publish_video' },
        { label: 'Publish Reel', id: 'instagram_publish_reel' },
        { label: 'Publish Story', id: 'instagram_publish_story' },
        { label: 'Publish Carousel', id: 'instagram_publish_carousel' },
        { label: 'Get Container Status', id: 'instagram_get_container_status' },
        { label: 'Get Publishing Limit', id: 'instagram_get_publishing_limit' },
        { label: 'List Comments', id: 'instagram_list_comments' },
        { label: 'Reply to Comment', id: 'instagram_reply_to_comment' },
        { label: 'Hide Comment', id: 'instagram_hide_comment' },
        { label: 'Delete Comment', id: 'instagram_delete_comment' },
        { label: 'Set Comments Enabled', id: 'instagram_set_comments_enabled' },
        { label: 'Private Reply', id: 'instagram_private_reply' },
        { label: 'List Conversations', id: 'instagram_list_conversations' },
        { label: 'Get Conversation Messages', id: 'instagram_get_conversation_messages' },
        { label: 'Get Message', id: 'instagram_get_message' },
        { label: 'Send Text Message', id: 'instagram_send_text_message' },
        { label: 'Get Account Insights', id: 'instagram_get_account_insights' },
        { label: 'Get Media Insights', id: 'instagram_get_media_insights' },
      ],
      value: () => 'instagram_get_profile',
    },

    {
      id: 'credential',
      title: 'Instagram Account',
      type: 'oauth-input',
      serviceId: 'instagram',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      requiredScopes: getScopesForService('instagram'),
      placeholder: 'Select Instagram account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Instagram Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    {
      id: 'imageUpload',
      title: 'Image',
      type: 'file-upload',
      canonicalParamId: 'image',
      placeholder: 'Upload a JPEG image to publish',
      acceptedTypes: '.jpg,.jpeg,image/jpeg',
      maxSize: 8,
      requiresCloudStorage: true,
      condition: { field: 'operation', value: 'instagram_publish_image' },
      mode: 'basic',
      multiple: false,
      required: { field: 'operation', value: 'instagram_publish_image' },
    },
    {
      id: 'imageRef',
      title: 'Image',
      type: 'short-input',
      canonicalParamId: 'image',
      placeholder: 'Reference files from previous blocks',
      condition: { field: 'operation', value: 'instagram_publish_image' },
      mode: 'advanced',
      required: { field: 'operation', value: 'instagram_publish_image' },
    },

    {
      id: 'videoUpload',
      title: 'Video',
      type: 'file-upload',
      canonicalParamId: 'video',
      placeholder: 'Upload a video to publish',
      acceptedTypes: '.mp4,.mov,video/mp4,video/quicktime',
      maxSize: 300,
      requiresCloudStorage: true,
      condition: {
        field: 'operation',
        value: ['instagram_publish_video', 'instagram_publish_reel'],
      },
      mode: 'basic',
      multiple: false,
      required: {
        field: 'operation',
        value: ['instagram_publish_video', 'instagram_publish_reel'],
      },
    },
    {
      id: 'videoRef',
      title: 'Video',
      type: 'short-input',
      canonicalParamId: 'video',
      placeholder: 'Reference files from previous blocks',
      condition: {
        field: 'operation',
        value: ['instagram_publish_video', 'instagram_publish_reel'],
      },
      mode: 'advanced',
      required: {
        field: 'operation',
        value: ['instagram_publish_video', 'instagram_publish_reel'],
      },
    },
    {
      id: 'coverUpload',
      title: 'Cover Image',
      type: 'file-upload',
      canonicalParamId: 'cover',
      placeholder: 'Upload a JPEG cover image',
      acceptedTypes: '.jpg,.jpeg,image/jpeg',
      maxSize: 8,
      requiresCloudStorage: true,
      condition: {
        field: 'operation',
        value: ['instagram_publish_video', 'instagram_publish_reel'],
      },
      mode: 'basic',
      multiple: false,
      required: false,
    },
    {
      id: 'coverRef',
      title: 'Cover Image',
      type: 'short-input',
      canonicalParamId: 'cover',
      placeholder: 'Reference files from previous blocks',
      condition: {
        field: 'operation',
        value: ['instagram_publish_video', 'instagram_publish_reel'],
      },
      mode: 'advanced',
      required: false,
    },

    {
      id: 'storyMediaUpload',
      title: 'Media',
      type: 'file-upload',
      canonicalParamId: 'media',
      placeholder: 'Upload a JPEG image or MP4/MOV video for the story',
      acceptedTypes: '.jpg,.jpeg,.mp4,.mov,image/jpeg,video/mp4,video/quicktime',
      maxSize: 100,
      requiresCloudStorage: true,
      condition: { field: 'operation', value: 'instagram_publish_story' },
      mode: 'basic',
      multiple: false,
      required: { field: 'operation', value: 'instagram_publish_story' },
    },
    {
      id: 'storyMediaRef',
      title: 'Media',
      type: 'short-input',
      canonicalParamId: 'media',
      placeholder: 'Reference files from previous blocks',
      condition: { field: 'operation', value: 'instagram_publish_story' },
      mode: 'advanced',
      required: { field: 'operation', value: 'instagram_publish_story' },
    },

    {
      id: 'carouselMediaUpload',
      title: 'Media',
      type: 'file-upload',
      canonicalParamId: 'carouselMedia',
      placeholder: 'Upload 2-10 images/videos to publish',
      acceptedTypes: '.jpg,.jpeg,.mp4,.mov,image/jpeg,video/mp4,video/quicktime',
      maxSize: 300,
      requiresCloudStorage: true,
      condition: { field: 'operation', value: 'instagram_publish_carousel' },
      mode: 'basic',
      multiple: true,
      required: { field: 'operation', value: 'instagram_publish_carousel' },
    },
    {
      id: 'carouselMediaRef',
      title: 'Media',
      type: 'long-input',
      canonicalParamId: 'carouselMedia',
      placeholder: 'Reference files from previous blocks',
      condition: { field: 'operation', value: 'instagram_publish_carousel' },
      mode: 'advanced',
      required: { field: 'operation', value: 'instagram_publish_carousel' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of public HTTPS media URLs for an Instagram carousel.
Use plain image URLs for photos. Prefix video URLs with "video:" (e.g. video:https://example.com/clip.mp4).
Between 2 and 10 items. Do not invent unreachable URLs — only use URLs the user provided or clearly implied.
Examples:
- "two photos" with urls A and B -> https://cdn.example/a.jpg,https://cdn.example/b.jpg
- "photo then video" -> https://cdn.example/a.jpg,video:https://cdn.example/b.mp4

Return ONLY the comma-separated URLs - no explanations, no extra text.`,
        placeholder: 'Describe the carousel media URLs to include...',
      },
    },

    {
      id: 'caption',
      title: 'Caption',
      type: 'long-input',
      placeholder: 'Write a caption...',
      condition: {
        field: 'operation',
        value: [
          'instagram_publish_image',
          'instagram_publish_video',
          'instagram_publish_reel',
          'instagram_publish_carousel',
        ],
      },
    },
    {
      id: 'altText',
      title: 'Alt Text',
      type: 'short-input',
      placeholder: 'Accessibility description for the image',
      mode: 'advanced',
      condition: { field: 'operation', value: 'instagram_publish_image' },
    },
    {
      id: 'isAiGenerated',
      title: 'AI Generated',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'instagram_publish_image' },
    },
    {
      id: 'shareToFeed',
      title: 'Share to Feed',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      mode: 'advanced',
      condition: { field: 'operation', value: 'instagram_publish_reel' },
    },
    {
      id: 'thumbOffset',
      title: 'Thumbnail Offset (ms)',
      type: 'short-input',
      placeholder: 'Video frame offset in milliseconds for the cover thumbnail',
      mode: 'advanced',
      condition: { field: 'operation', value: 'instagram_publish_reel' },
    },

    {
      id: 'mediaId',
      title: 'Media ID',
      type: 'short-input',
      placeholder: 'Enter Instagram media ID',
      condition: {
        field: 'operation',
        value: [
          'instagram_get_media',
          'instagram_download_media',
          'instagram_list_comments',
          'instagram_set_comments_enabled',
          'instagram_get_media_insights',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'instagram_get_media',
          'instagram_download_media',
          'instagram_list_comments',
          'instagram_set_comments_enabled',
          'instagram_get_media_insights',
        ],
      },
    },
    {
      id: 'filename',
      title: 'Filename',
      type: 'short-input',
      placeholder: 'Optional filename override',
      mode: 'advanced',
      condition: { field: 'operation', value: 'instagram_download_media' },
    },
    {
      id: 'containerId',
      title: 'Container ID',
      type: 'short-input',
      placeholder: 'Enter media container ID',
      condition: { field: 'operation', value: 'instagram_get_container_status' },
      required: { field: 'operation', value: 'instagram_get_container_status' },
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Enter comment ID',
      condition: {
        field: 'operation',
        value: [
          'instagram_reply_to_comment',
          'instagram_hide_comment',
          'instagram_delete_comment',
          'instagram_private_reply',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'instagram_reply_to_comment',
          'instagram_hide_comment',
          'instagram_delete_comment',
          'instagram_private_reply',
        ],
      },
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Enter message text',
      condition: {
        field: 'operation',
        value: [
          'instagram_reply_to_comment',
          'instagram_private_reply',
          'instagram_send_text_message',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'instagram_reply_to_comment',
          'instagram_private_reply',
          'instagram_send_text_message',
        ],
      },
    },
    {
      id: 'hide',
      title: 'Hide Comment',
      type: 'dropdown',
      options: [
        { label: 'Hide', id: 'true' },
        { label: 'Unhide', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'instagram_hide_comment' },
      required: { field: 'operation', value: 'instagram_hide_comment' },
    },
    {
      id: 'commentEnabled',
      title: 'Comments Enabled',
      type: 'dropdown',
      options: [
        { label: 'Enable', id: 'true' },
        { label: 'Disable', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'instagram_set_comments_enabled' },
      required: { field: 'operation', value: 'instagram_set_comments_enabled' },
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'Enter conversation ID',
      condition: { field: 'operation', value: 'instagram_get_conversation_messages' },
      required: { field: 'operation', value: 'instagram_get_conversation_messages' },
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Enter message ID',
      condition: { field: 'operation', value: 'instagram_get_message' },
      required: { field: 'operation', value: 'instagram_get_message' },
    },
    {
      id: 'recipientId',
      title: 'Recipient ID',
      type: 'short-input',
      placeholder: 'Instagram-scoped user ID',
      condition: { field: 'operation', value: 'instagram_send_text_message' },
      required: { field: 'operation', value: 'instagram_send_text_message' },
    },
    {
      id: 'metrics',
      title: 'Metrics',
      type: 'short-input',
      placeholder: 'Comma-separated metrics (e.g. reach,views,likes)',
      condition: {
        field: 'operation',
        value: ['instagram_get_account_insights', 'instagram_get_media_insights'],
      },
      required: {
        field: 'operation',
        value: ['instagram_get_account_insights', 'instagram_get_media_insights'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Instagram Insights metric names based on the user's request.
Account insights examples: reach,views,accounts_engaged,likes,comments,saves,shares,total_interactions
Media insights examples: views,reach,likes,comments,saved,shares,total_interactions
Use only valid Instagram Graph metric names. Prefer the smallest useful set.

Return ONLY the comma-separated metric names - no explanations, no extra text.`,
        placeholder: 'Describe which insight metrics you need...',
      },
    },
    {
      id: 'period',
      title: 'Period',
      type: 'dropdown',
      options: [
        { label: 'Day', id: 'day' },
        { label: 'Lifetime', id: 'lifetime' },
      ],
      value: () => 'day',
      condition: { field: 'operation', value: 'instagram_get_account_insights' },
      required: { field: 'operation', value: 'instagram_get_account_insights' },
    },
    {
      id: 'since',
      title: 'Since',
      type: 'short-input',
      placeholder: 'Unix timestamp or YYYY-MM-DD',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'instagram_get_account_insights',
        and: { field: 'period', value: 'day' },
      },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: `Generate a Unix timestamp in seconds (or YYYY-MM-DD) for the start of an Instagram insights range based on the user's description.
Examples:
- "7 days ago" -> Unix timestamp for 7 days ago at 00:00:00 UTC
- "start of last month" -> Unix timestamp for the first day of last month

Return ONLY the timestamp or date - no explanations, no extra text.`,
        placeholder: 'Describe the range start (e.g. "7 days ago")...',
      },
    },
    {
      id: 'until',
      title: 'Until',
      type: 'short-input',
      placeholder: 'Unix timestamp or YYYY-MM-DD',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'instagram_get_account_insights',
        and: { field: 'period', value: 'day' },
      },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: `Generate a Unix timestamp in seconds (or YYYY-MM-DD) for the end of an Instagram insights range based on the user's description.
Examples:
- "now" -> current Unix timestamp
- "end of yesterday" -> Unix timestamp for yesterday 23:59:59 UTC

Return ONLY the timestamp or date - no explanations, no extra text.`,
        placeholder: 'Describe the range end (e.g. "now")...',
      },
    },
    {
      id: 'metricType',
      title: 'Metric Type',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Time Series', id: 'time_series' },
        { label: 'Total Value', id: 'total_value' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'instagram_get_account_insights' },
    },
    {
      id: 'breakdown',
      title: 'Breakdown',
      type: 'short-input',
      placeholder: 'Optional breakdown dimension',
      mode: 'advanced',
      condition: { field: 'operation', value: 'instagram_get_account_insights' },
    },
    {
      id: 'timeframe',
      title: 'Demographic Timeframe',
      type: 'dropdown',
      options: [
        { label: 'This Week', id: 'this_week' },
        { label: 'This Month', id: 'this_month' },
      ],
      value: () => 'this_month',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'instagram_get_account_insights',
        and: { field: 'period', value: 'lifetime' },
      },
      required: {
        field: 'operation',
        value: 'instagram_get_account_insights',
        and: { field: 'period', value: 'lifetime' },
      },
    },

    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (1-100, default 25)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'instagram_list_media',
          'instagram_list_stories',
          'instagram_list_comments',
          'instagram_list_conversations',
          'instagram_get_conversation_messages',
        ],
      },
    },
    {
      id: 'after',
      title: 'After Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from a previous response',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'instagram_list_media',
          'instagram_list_stories',
          'instagram_list_comments',
          'instagram_list_conversations',
          'instagram_get_conversation_messages',
        ],
      },
    },
    {
      id: 'igUserId',
      title: 'Instagram User ID',
      type: 'short-input',
      placeholder: 'Optional IG professional account user id',
      mode: 'advanced',
      condition: { field: 'operation', value: IG_USER_ID_OPS },
    },
  ],
  tools: {
    access: [
      'instagram_get_profile',
      'instagram_list_media',
      'instagram_get_media',
      'instagram_download_media',
      'instagram_list_stories',
      'instagram_publish_image',
      'instagram_publish_video',
      'instagram_publish_reel',
      'instagram_publish_story',
      'instagram_publish_carousel',
      'instagram_get_container_status',
      'instagram_get_publishing_limit',
      'instagram_list_comments',
      'instagram_reply_to_comment',
      'instagram_hide_comment',
      'instagram_delete_comment',
      'instagram_set_comments_enabled',
      'instagram_private_reply',
      'instagram_list_conversations',
      'instagram_get_conversation_messages',
      'instagram_get_message',
      'instagram_send_text_message',
      'instagram_get_account_insights',
      'instagram_get_media_insights',
    ],
    config: {
      tool: (params) => {
        const operation =
          typeof params.operation === 'string' ? params.operation : 'instagram_get_profile'
        if (!INSTAGRAM_TOOL_IDS.has(operation)) {
          throw new Error(`Unsupported Instagram operation: ${operation}`)
        }
        return operation
      },
      params: (params) => {
        const operation = typeof params.operation === 'string' ? params.operation : ''
        const result: Record<string, unknown> = {
          credential: params.oauthCredential,
        }

        for (const key of INSTAGRAM_OPERATION_INPUT_KEYS) {
          result[key] = undefined
        }

        if (operation === 'instagram_publish_image') {
          const resolved = resolveSingleMediaInput(params.image)
          if (resolved) result.image = resolved
        } else if (
          operation === 'instagram_publish_video' ||
          operation === 'instagram_publish_reel'
        ) {
          const resolvedVideo = resolveSingleMediaInput(params.video)
          if (resolvedVideo) result.video = resolvedVideo
          const resolvedCover = resolveSingleMediaInput(params.cover)
          if (resolvedCover) result.cover = resolvedCover
        } else if (operation === 'instagram_publish_story') {
          const resolved = resolveSingleMediaInput(params.media)
          if (resolved) result.media = resolved
        } else if (operation === 'instagram_publish_carousel') {
          const resolved = resolveCarouselMediaInput(params.carouselMedia)
          if (resolved) result.media = resolved
        }

        for (const key of OPERATION_PARAM_KEYS[operation] ?? []) {
          const value = params[key]
          if (value === undefined || value === null || value === '') continue

          if (NUMERIC_PARAM_KEYS.has(key)) {
            result[key] = Number(value)
          } else if (BOOLEAN_PARAM_KEYS.has(key)) {
            result[key] = value === true || value === 'true'
          } else {
            result[key] = value
          }
        }

        if (operation === 'instagram_get_account_insights') {
          if (result.period === 'day') {
            result.timeframe = undefined
          } else if (result.period === 'lifetime') {
            result.since = undefined
            result.until = undefined
          } else {
            throw new Error('Instagram account insights period must be day or lifetime')
          }
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Instagram OAuth credential' },
    image: { type: 'json', description: 'JPEG image file or public HTTPS URL for Publish Image' },
    video: {
      type: 'json',
      description: 'Video file or public HTTPS URL for Publish Video / Publish Reel',
    },
    cover: {
      type: 'json',
      description: 'Optional JPEG cover image file or public HTTPS URL',
    },
    media: {
      type: 'json',
      description: 'Story media: single JPEG image or MP4/MOV video file, or a public HTTPS URL',
    },
    carouselMedia: {
      type: 'json',
      description:
        'Carousel media: 2-10 files, or comma-separated public HTTPS URLs (prefix videos with video:)',
    },
    caption: { type: 'string', description: 'Post caption' },
    altText: { type: 'string', description: 'Image accessibility alt text' },
    isAiGenerated: { type: 'boolean', description: 'Whether the image is AI-generated' },
    shareToFeed: { type: 'boolean', description: 'Also share Reel to the main feed' },
    thumbOffset: {
      type: 'number',
      description: 'Video frame offset in milliseconds for the Reel cover thumbnail',
    },
    mediaId: { type: 'string', description: 'Instagram media ID' },
    filename: { type: 'string', description: 'Optional filename override for Download Media' },
    containerId: { type: 'string', description: 'Media container ID' },
    commentId: { type: 'string', description: 'Comment ID' },
    message: { type: 'string', description: 'Message or reply text' },
    hide: { type: 'boolean', description: 'Hide or unhide a comment' },
    commentEnabled: { type: 'boolean', description: 'Enable or disable comments on media' },
    conversationId: { type: 'string', description: 'DM conversation ID' },
    messageId: { type: 'string', description: 'DM message ID' },
    recipientId: { type: 'string', description: 'DM recipient Instagram-scoped ID' },
    metrics: { type: 'string', description: 'Comma-separated insight metrics' },
    period: { type: 'string', description: 'Account insight period: day or lifetime' },
    since: { type: 'string', description: 'Account insights range start' },
    until: { type: 'string', description: 'Account insights range end' },
    metricType: { type: 'string', description: 'Account insights metric_type' },
    breakdown: { type: 'string', description: 'Account insights breakdown dimension' },
    timeframe: {
      type: 'string',
      description: 'Demographic insight timeframe: this_week or this_month',
    },
    limit: { type: 'number', description: 'Maximum number of results' },
    after: { type: 'string', description: 'Pagination cursor' },
    igUserId: { type: 'string', description: 'Instagram professional account user ID' },
  },
  outputs: {
    userId: {
      type: 'string',
      description: 'Instagram professional account user_id',
      condition: { field: 'operation', value: 'instagram_get_profile' },
    },
    id: {
      type: 'string',
      description: 'Graph object, comment, or message ID',
      condition: {
        field: 'operation',
        value: [
          'instagram_get_profile',
          'instagram_get_media',
          'instagram_reply_to_comment',
          'instagram_get_message',
        ],
      },
    },
    username: {
      type: 'string',
      description: 'Instagram username',
      condition: { field: 'operation', value: 'instagram_get_profile' },
    },
    name: {
      type: 'string',
      description: 'Display name',
      condition: { field: 'operation', value: 'instagram_get_profile' },
    },
    accountType: {
      type: 'string',
      description: 'Business or Media_Creator',
      condition: { field: 'operation', value: 'instagram_get_profile' },
    },
    profilePictureUrl: {
      type: 'string',
      description: 'Profile picture URL',
      condition: { field: 'operation', value: 'instagram_get_profile' },
    },
    followersCount: {
      type: 'number',
      description: 'Follower count',
      condition: { field: 'operation', value: 'instagram_get_profile' },
    },
    followsCount: {
      type: 'number',
      description: 'Following count',
      condition: { field: 'operation', value: 'instagram_get_profile' },
    },
    mediaCount: {
      type: 'number',
      description: 'Media count',
      condition: { field: 'operation', value: 'instagram_get_profile' },
    },
    media: {
      type: 'array',
      description: 'Media objects from this page',
      condition: { field: 'operation', value: 'instagram_list_media' },
    },
    files: {
      type: 'file[]',
      description:
        'Downloaded media as canonical User Files (100 MB max each), ordered by carousel position',
      condition: { field: 'operation', value: 'instagram_download_media' },
    },
    downloadedCount: {
      type: 'number',
      description: 'Number of media files downloaded',
      condition: { field: 'operation', value: 'instagram_download_media' },
    },
    caption: {
      type: 'string',
      description: 'Media caption text',
      condition: { field: 'operation', value: 'instagram_get_media' },
    },
    mediaType: {
      type: 'string',
      description: 'IMAGE, VIDEO, or CAROUSEL_ALBUM',
      condition: {
        field: 'operation',
        value: ['instagram_get_media', 'instagram_download_media'],
      },
    },
    mediaProductType: {
      type: 'string',
      description: 'Feed, Reels, or Stories product type',
      condition: { field: 'operation', value: 'instagram_get_media' },
    },
    mediaUrl: {
      type: 'string',
      description: 'Instagram media URL when available',
      condition: { field: 'operation', value: 'instagram_get_media' },
    },
    permalink: {
      type: 'string',
      description: 'Permalink to the post',
      condition: { field: 'operation', value: 'instagram_get_media' },
    },
    timestamp: {
      type: 'string',
      description: 'ISO timestamp',
      condition: { field: 'operation', value: 'instagram_get_media' },
    },
    likeCount: {
      type: 'number',
      description: 'Like count',
      condition: { field: 'operation', value: 'instagram_get_media' },
    },
    commentsCount: {
      type: 'number',
      description: 'Comments count',
      condition: { field: 'operation', value: 'instagram_get_media' },
    },
    children: {
      type: 'array',
      description: 'Carousel child media IDs',
      condition: { field: 'operation', value: 'instagram_get_media' },
    },
    stories: {
      type: 'array',
      description: 'Active stories from this page',
      condition: { field: 'operation', value: 'instagram_list_stories' },
    },
    containerId: {
      type: 'string',
      description: 'Media container ID',
      condition: {
        field: 'operation',
        value: [
          'instagram_publish_image',
          'instagram_publish_video',
          'instagram_publish_reel',
          'instagram_publish_story',
          'instagram_publish_carousel',
          'instagram_get_container_status',
        ],
      },
    },
    mediaId: {
      type: 'string',
      description: 'Published or downloaded media ID',
      condition: {
        field: 'operation',
        value: [
          'instagram_download_media',
          'instagram_publish_image',
          'instagram_publish_video',
          'instagram_publish_reel',
          'instagram_publish_story',
          'instagram_publish_carousel',
        ],
      },
    },
    statusCode: {
      type: 'string',
      description: 'Container status (EXPIRED, ERROR, FINISHED, IN_PROGRESS, or PUBLISHED)',
      condition: {
        field: 'operation',
        value: [
          'instagram_publish_image',
          'instagram_publish_video',
          'instagram_publish_reel',
          'instagram_publish_story',
          'instagram_publish_carousel',
          'instagram_get_container_status',
        ],
      },
    },
    status: {
      type: 'string',
      description: 'Detailed container status message',
      condition: { field: 'operation', value: 'instagram_get_container_status' },
    },
    quotaUsage: {
      type: 'number',
      description: 'Publishes used in the current window',
      condition: { field: 'operation', value: 'instagram_get_publishing_limit' },
    },
    config: {
      type: 'json',
      description: 'Publishing quota config',
      condition: { field: 'operation', value: 'instagram_get_publishing_limit' },
    },
    comments: {
      type: 'array',
      description: 'Comments from this page',
      condition: { field: 'operation', value: 'instagram_list_comments' },
    },
    success: {
      type: 'boolean',
      description: 'Whether the operation succeeded',
      condition: {
        field: 'operation',
        value: [
          'instagram_hide_comment',
          'instagram_delete_comment',
          'instagram_set_comments_enabled',
        ],
      },
    },
    conversations: {
      type: 'array',
      description: 'Instagram Direct conversations from this page',
      condition: { field: 'operation', value: 'instagram_list_conversations' },
    },
    conversationId: {
      type: 'string',
      description: 'Conversation ID',
      condition: { field: 'operation', value: 'instagram_get_conversation_messages' },
    },
    messages: {
      type: 'array',
      description: 'Message references; use Get Message for sender, recipient, and text',
      condition: { field: 'operation', value: 'instagram_get_conversation_messages' },
    },
    createdTime: {
      type: 'string',
      description: 'Message created timestamp',
      condition: { field: 'operation', value: 'instagram_get_message' },
    },
    fromId: {
      type: 'string',
      description: 'Sender Instagram-scoped ID',
      condition: { field: 'operation', value: 'instagram_get_message' },
    },
    fromUsername: {
      type: 'string',
      description: 'Sender username',
      condition: { field: 'operation', value: 'instagram_get_message' },
    },
    toId: {
      type: 'string',
      description: 'Recipient ID',
      condition: { field: 'operation', value: 'instagram_get_message' },
    },
    message: {
      type: 'string',
      description: 'Message text',
      condition: { field: 'operation', value: 'instagram_get_message' },
    },
    messageId: {
      type: 'string',
      description: 'Sent message ID',
      condition: {
        field: 'operation',
        value: ['instagram_private_reply', 'instagram_send_text_message'],
      },
    },
    recipientId: {
      type: 'string',
      description: 'DM recipient ID',
      condition: {
        field: 'operation',
        value: ['instagram_private_reply', 'instagram_send_text_message'],
      },
    },
    insights: {
      type: 'array',
      description: 'Insight metrics',
      condition: {
        field: 'operation',
        value: ['instagram_get_account_insights', 'instagram_get_media_insights'],
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      condition: {
        field: 'operation',
        value: [
          'instagram_list_media',
          'instagram_list_stories',
          'instagram_list_comments',
          'instagram_list_conversations',
          'instagram_get_conversation_messages',
        ],
      },
    },
  },
}

export const InstagramBlockMeta = {
  tags: ['marketing', 'messaging', 'automation'],
  url: 'https://www.instagram.com',
  templates: [
    {
      icon: InstagramIcon,
      title: 'Instagram content publisher',
      prompt:
        'Build a workflow that reads approved posts from a content table, publishes each as an Instagram image or Reel with caption, checks container status until finished, and writes the published media ID back to the row.',
      modules: ['tables', 'scheduled', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'automation'],
    },
    {
      icon: InstagramIcon,
      title: 'Instagram comment moderator',
      prompt:
        'Create a scheduled workflow that lists recent Instagram media, pulls comments on each post, uses an agent to flag spam or abusive replies, and hides or deletes those comments while logging actions to a moderation table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'moderation'],
    },
    {
      icon: InstagramIcon,
      title: 'Instagram DM reply assistant',
      prompt:
        'Build a workflow that lists Instagram Direct conversations, fetches recent message references and details, drafts helpful replies with an agent, and sends text messages back to the recipient while logging the thread to a support table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['messaging', 'support', 'automation'],
    },
    {
      icon: InstagramIcon,
      title: 'Instagram insights digest',
      prompt:
        'Create a scheduled weekly workflow that fetches Instagram account insights and media insights for top posts, summarizes performance with an agent, and writes a digest to a marketing table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analytics', 'automation'],
    },
  ],
  skills: [
    {
      name: 'publish-instagram-image',
      description:
        'Publish a JPEG image to Instagram with an optional caption and accessibility alt text.',
      content:
        '# Publish Instagram Image\n\nPublish a single image post to the connected Instagram professional account.\n\n## Steps\n1. Upload a JPEG image (or reference a file from a previous block / paste a public HTTPS JPEG URL) and draft a caption within Instagram length limits.\n2. Optionally set alt text for accessibility and mark the post as AI-generated when applicable.\n3. Run Publish Image, then optionally Get Container Status if you need to confirm publishing finished.\n\n## Output\nThe published media ID, container ID, and final container status.',
    },
    {
      name: 'moderate-instagram-comments',
      description:
        'List comments on a post and hide, delete, or reply to ones that need moderation.',
      content:
        '# Moderate Instagram Comments\n\nReview and act on comments for a specific Instagram media object.\n\n## Steps\n1. List Comments for the target media ID and review text, username, and hidden state.\n2. Hide Comment or Delete Comment for spam or abusive replies; Reply to Comment for public responses; Private Reply when a DM follow-up is better.\n3. Optionally Set Comments Enabled to turn commenting off on the post.\n\n## Output\nA short summary of actions taken (hidden, deleted, replied) with comment IDs.',
    },
    {
      name: 'reply-instagram-dm',
      description: 'Open an Instagram Direct conversation and send a text reply to the recipient.',
      content:
        '# Reply Instagram DM\n\nRespond to an Instagram Direct message thread.\n\n## Steps\n1. List Conversations to find the thread, then Get Conversation Messages for message references.\n2. Optionally Get Message for one of the 20 most recent message IDs when you need full details.\n3. Send Text Message to the recipient ID with a clear, helpful reply.\n\n## Output\nThe sent message ID and recipient ID.',
    },
    {
      name: 'fetch-instagram-insights',
      description:
        'Pull account-level or media-level Instagram insights for reporting and analysis.',
      content:
        '# Fetch Instagram Insights\n\nRetrieve performance metrics for the account or a specific post.\n\n## Steps\n1. For account interaction trends, run Get Account Insights with comma-separated metrics and the day period. Use lifetime plus a timeframe for demographic metrics.\n2. For a specific post, run Get Media Insights with the media ID and metrics like views, reach, likes, comments, saved, or shares.\n3. Summarize the returned insight values for the reporting window.\n\n## Output\nThe insights JSON plus a short plain-language summary of the key metrics.',
    },
    {
      name: 'download-instagram-media',
      description: 'Download an Instagram post or story as canonical User Files.',
      content:
        '# Download Instagram Media\n\nMaterialize Instagram media into durable User Files for downstream blocks.\n\n## Steps\n1. Use List Media, Get Media, or List Stories to find the media ID.\n2. Run Download Media with that ID. Carousel children are downloaded in display order.\n3. Pass the files output directly to a file[] input such as Gmail attachments.\n\n## Output\nA canonical User File array plus the source media ID, media type, and downloaded count.',
    },
  ],
} as const satisfies BlockMeta
