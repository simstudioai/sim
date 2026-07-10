import { InstagramIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { InstagramResponse } from '@/tools/instagram/types'

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

export const InstagramBlock: BlockConfig<InstagramResponse> = {
  type: 'instagram',
  name: 'Instagram',
  description: 'Publish content, moderate comments, and manage Instagram DMs',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Instagram into workflows. Publish images, videos, Reels, stories, and carousels; moderate comments; send DMs; and pull account or media insights.',
  docsLink: 'https://docs.sim.ai/integrations/instagram',
  category: 'tools',
  integrationType: IntegrationType.Marketing,
  bgColor: '#E4405F',
  iconColor: '#E4405F',
  icon: InstagramIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Profile', id: 'instagram_get_profile' },
        { label: 'List Media', id: 'instagram_list_media' },
        { label: 'Get Media', id: 'instagram_get_media' },
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
      id: 'imageUrl',
      title: 'Image URL',
      type: 'short-input',
      placeholder: 'https://example.com/image.jpg',
      condition: {
        field: 'operation',
        value: ['instagram_publish_image', 'instagram_publish_story'],
      },
      required: { field: 'operation', value: 'instagram_publish_image' },
    },
    {
      id: 'videoUrl',
      title: 'Video URL',
      type: 'short-input',
      placeholder: 'https://example.com/video.mp4 (for stories: use image OR video URL, not both)',
      condition: {
        field: 'operation',
        value: ['instagram_publish_video', 'instagram_publish_reel', 'instagram_publish_story'],
      },
      required: {
        field: 'operation',
        value: ['instagram_publish_video', 'instagram_publish_reel'],
      },
    },
    {
      id: 'mediaUrls',
      title: 'Media URLs',
      type: 'long-input',
      placeholder: 'Comma-separated public URLs (prefix videos with video:)',
      condition: { field: 'operation', value: 'instagram_publish_carousel' },
      required: { field: 'operation', value: 'instagram_publish_carousel' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of public HTTPS media URLs for an Instagram carousel.
Use plain image URLs for photos. Prefix video URLs with "video:" (e.g. video:https://example.com/clip.mp4).
Maximum 10 items. Do not invent unreachable URLs — only use URLs the user provided or clearly implied.
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
      id: 'coverUrl',
      title: 'Cover URL',
      type: 'short-input',
      placeholder: 'https://example.com/cover.jpg',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['instagram_publish_video', 'instagram_publish_reel'],
      },
    },
    {
      id: 'shareToFeed',
      title: 'Share to Feed',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
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
          'instagram_list_comments',
          'instagram_set_comments_enabled',
          'instagram_get_media_insights',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'instagram_get_media',
          'instagram_list_comments',
          'instagram_set_comments_enabled',
          'instagram_get_media_insights',
        ],
      },
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
Account insights examples: reach,views,accounts_engaged,profile_views,follower_count,website_clicks
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
        { label: 'Week', id: 'week' },
        { label: '28 Days', id: 'days_28' },
        { label: 'Lifetime', id: 'lifetime' },
        { label: 'Total Over Range', id: 'total_over_range' },
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
      condition: { field: 'operation', value: 'instagram_get_account_insights' },
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
      condition: { field: 'operation', value: 'instagram_get_account_insights' },
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
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (1-100, default 25)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['instagram_list_media', 'instagram_list_comments', 'instagram_list_conversations'],
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
        value: ['instagram_list_media', 'instagram_list_comments', 'instagram_list_conversations'],
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
      tool: (params) => params.operation,
      params: (params) => {
        const { oauthCredential, ...rest } = params
        const result: Record<string, unknown> = {
          credential: oauthCredential,
        }

        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined || value === null || value === '') continue
          if (key === 'operation' || key === 'credential' || key === 'manualCredential') continue

          if (key === 'limit' || key === 'thumbOffset') {
            result[key] = Number(value)
          } else if (
            key === 'hide' ||
            key === 'commentEnabled' ||
            key === 'shareToFeed' ||
            key === 'isAiGenerated'
          ) {
            result[key] = value === true || value === 'true'
          } else {
            result[key] = value
          }
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Instagram OAuth credential' },
    imageUrl: { type: 'string', description: 'Public HTTPS image URL' },
    videoUrl: { type: 'string', description: 'Public HTTPS video URL' },
    mediaUrls: { type: 'string', description: 'Comma-separated media URLs for carousel' },
    caption: { type: 'string', description: 'Post caption' },
    altText: { type: 'string', description: 'Image accessibility alt text' },
    isAiGenerated: { type: 'boolean', description: 'Whether the image is AI-generated' },
    coverUrl: { type: 'string', description: 'Cover image URL for video or Reel' },
    shareToFeed: { type: 'boolean', description: 'Also share Reel to the main feed' },
    thumbOffset: {
      type: 'number',
      description: 'Video frame offset in milliseconds for the Reel cover thumbnail',
    },
    mediaId: { type: 'string', description: 'Instagram media ID' },
    containerId: { type: 'string', description: 'Media container ID' },
    commentId: { type: 'string', description: 'Comment ID' },
    message: { type: 'string', description: 'Message or reply text' },
    hide: { type: 'boolean', description: 'Hide or unhide a comment' },
    commentEnabled: { type: 'boolean', description: 'Enable or disable comments on media' },
    conversationId: { type: 'string', description: 'DM conversation ID' },
    messageId: { type: 'string', description: 'DM message ID' },
    recipientId: { type: 'string', description: 'DM recipient Instagram-scoped ID' },
    metrics: { type: 'string', description: 'Comma-separated insight metrics' },
    period: { type: 'string', description: 'Insight aggregation period' },
    since: { type: 'string', description: 'Account insights range start' },
    until: { type: 'string', description: 'Account insights range end' },
    metricType: { type: 'string', description: 'Account insights metric_type' },
    breakdown: { type: 'string', description: 'Account insights breakdown dimension' },
    limit: { type: 'number', description: 'Maximum number of results' },
    after: { type: 'string', description: 'Pagination cursor' },
    igUserId: { type: 'string', description: 'Instagram professional account user ID' },
  },
  outputs: {
    // Profile
    userId: { type: 'string', description: 'Instagram professional account user_id' },
    id: { type: 'string', description: 'Graph object or message id' },
    username: { type: 'string', description: 'Instagram username' },
    name: { type: 'string', description: 'Display name' },
    accountType: { type: 'string', description: 'Business or Media_Creator' },
    profilePictureUrl: { type: 'string', description: 'Profile picture URL' },
    followersCount: { type: 'number', description: 'Follower count' },
    followsCount: { type: 'number', description: 'Following count' },
    mediaCount: { type: 'number', description: 'Media count' },
    // Media
    media: {
      type: 'json',
      description:
        'List of media objects (id, caption, mediaType, mediaProductType, mediaUrl, permalink, timestamp, likeCount, commentsCount)',
    },
    caption: { type: 'string', description: 'Media caption text' },
    mediaType: { type: 'string', description: 'IMAGE, VIDEO, or CAROUSEL_ALBUM' },
    mediaProductType: { type: 'string', description: 'Feed, Reels, or Stories product type' },
    mediaUrl: { type: 'string', description: 'CDN media URL when available' },
    permalink: { type: 'string', description: 'Permalink to the post' },
    timestamp: { type: 'string', description: 'ISO timestamp' },
    likeCount: { type: 'number', description: 'Like count' },
    commentsCount: { type: 'number', description: 'Comments count' },
    children: { type: 'json', description: 'Carousel child media ids' },
    stories: {
      type: 'json',
      description: 'Active stories (id, mediaType, mediaUrl, timestamp)',
    },
    // Publishing
    containerId: { type: 'string', description: 'Media container id' },
    mediaId: { type: 'string', description: 'Published media id' },
    statusCode: {
      type: 'string',
      description: 'Container status (EXPIRED, ERROR, FINISHED, IN_PROGRESS, or PUBLISHED)',
    },
    status: { type: 'string', description: 'Detailed container status message' },
    quotaUsage: { type: 'number', description: 'Publishes used in the current window' },
    config: { type: 'json', description: 'Publishing quota config (quotaTotal, quotaDuration)' },
    // Comments
    comments: {
      type: 'json',
      description: 'Comments (id, text, username, timestamp, likeCount, hidden)',
    },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    // Messaging
    conversations: { type: 'json', description: 'Conversations (id, updatedTime)' },
    conversationId: { type: 'string', description: 'Conversation id' },
    messages: {
      type: 'json',
      description: 'Messages (id, createdTime, fromId, fromUsername, message)',
    },
    createdTime: { type: 'string', description: 'Message created timestamp' },
    fromId: { type: 'string', description: 'Sender Instagram-scoped id' },
    fromUsername: { type: 'string', description: 'Sender username' },
    toId: { type: 'string', description: 'Recipient id' },
    message: { type: 'string', description: 'Message text' },
    messageId: { type: 'string', description: 'Sent or retrieved message id' },
    recipientId: { type: 'string', description: 'DM recipient id' },
    // Insights & pagination
    insights: {
      type: 'json',
      description: 'Insight metrics (name, period, title, description, values, totalValue)',
    },
    nextCursor: { type: 'string', description: 'Pagination cursor for the next page' },
    error: { type: 'string', description: 'Error message if the operation failed' },
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
        'Build a workflow that lists Instagram Direct conversations, fetches unread messages, drafts helpful replies with an agent, and sends text messages back to the recipient while logging the thread to a support table.',
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
        '# Publish Instagram Image\n\nPublish a single image post to the connected Instagram professional account.\n\n## Steps\n1. Confirm a public HTTPS JPEG URL for the image and draft a caption within Instagram length limits.\n2. Optionally set alt text for accessibility and mark the post as AI-generated when applicable.\n3. Run Publish Image, then optionally Get Container Status if you need to confirm publishing finished.\n\n## Output\nThe published media ID, container ID, status, and the final caption used.',
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
        '# Reply Instagram DM\n\nRespond to an Instagram Direct message thread.\n\n## Steps\n1. List Conversations to find the thread, then Get Conversation Messages for recent context.\n2. Optionally Get Message for a specific message ID if you need full details.\n3. Send Text Message to the recipient ID with a clear, helpful reply.\n\n## Output\nThe sent message ID, recipient ID, and the reply text used.',
    },
    {
      name: 'fetch-instagram-insights',
      description:
        'Pull account-level or media-level Instagram insights for reporting and analysis.',
      content:
        '# Fetch Instagram Insights\n\nRetrieve performance metrics for the account or a specific post.\n\n## Steps\n1. For account trends, run Get Account Insights with comma-separated metrics and a period such as day, week, or days_28.\n2. For a specific post, run Get Media Insights with the media ID and metrics like views, reach, likes, comments, saved, or shares.\n3. Summarize the returned insight values for the reporting window.\n\n## Output\nThe insights JSON plus a short plain-language summary of the key metrics.',
    },
  ],
} as const satisfies BlockMeta
