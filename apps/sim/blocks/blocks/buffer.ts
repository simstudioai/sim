import { BufferIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { BufferPostResponse } from '@/tools/buffer/types'

const POST_EDIT_OPS = ['create_post', 'edit_post']

export const BufferBlock: BlockConfig<BufferPostResponse> = {
  type: 'buffer',
  name: 'Buffer',
  description: 'Schedule and publish social media posts across connected channels',
  longDescription:
    'Integrate Buffer into your workflow. Create, schedule, edit, and delete posts across connected social channels (Instagram, LinkedIn, X, Facebook, TikTok, and more), attach images or videos, browse channels, and capture content ideas using the Buffer API.',
  docsLink: 'https://docs.sim.ai/integrations/buffer',
  category: 'tools',
  integrationType: IntegrationType.Marketing,
  bgColor: '#FFFFFF',
  icon: BufferIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Post', id: 'create_post' },
        { label: 'Edit Post', id: 'edit_post' },
        { label: 'Get Posts', id: 'get_posts' },
        { label: 'Get Post', id: 'get_post' },
        { label: 'Delete Post', id: 'delete_post' },
        { label: 'Get Channels', id: 'get_channels' },
        { label: 'Create Idea', id: 'create_idea' },
        { label: 'Get Ideas', id: 'get_ideas' },
        { label: 'Get Idea Groups', id: 'get_idea_groups' },
        { label: 'Get Account', id: 'get_account' },
      ],
      value: () => 'create_post',
    },

    // Channel to post to
    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      placeholder: 'Find channel IDs with the Get Channels operation',
      condition: { field: 'operation', value: 'create_post' },
      required: { field: 'operation', value: 'create_post' },
    },

    // Post identifier (edit/get/delete)
    {
      id: 'postId',
      title: 'Post ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['edit_post', 'get_post', 'delete_post'] },
      required: { field: 'operation', value: ['edit_post', 'get_post', 'delete_post'] },
    },

    // Organization scope (list/idea operations)
    {
      id: 'organizationId',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Find organization IDs with the Get Account operation',
      condition: {
        field: 'operation',
        value: ['get_posts', 'get_channels', 'create_idea', 'get_ideas', 'get_idea_groups'],
      },
      required: {
        field: 'operation',
        value: ['get_posts', 'get_channels', 'create_idea', 'get_ideas', 'get_idea_groups'],
      },
    },

    // Post / idea content
    {
      id: 'text',
      title: 'Text',
      type: 'long-input',
      placeholder: 'What would you like to share?',
      condition: { field: 'operation', value: [...POST_EDIT_OPS, 'create_idea'] },
      required: { field: 'operation', value: 'create_idea' },
    },
    {
      id: 'mode',
      title: 'Share Mode',
      type: 'dropdown',
      options: [
        { label: 'Add to queue', id: 'addToQueue' },
        { label: 'Share next', id: 'shareNext' },
        { label: 'Share now', id: 'shareNow' },
        { label: 'Custom schedule', id: 'customScheduled' },
      ],
      value: () => 'addToQueue',
      condition: { field: 'operation', value: POST_EDIT_OPS },
      required: { field: 'operation', value: POST_EDIT_OPS },
    },
    {
      id: 'dueAt',
      title: 'Publish Time',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp, e.g. 2026-08-01T15:00:00Z',
      condition: {
        field: 'operation',
        value: POST_EDIT_OPS,
        and: { field: 'mode', value: 'customScheduled' },
      },
      required: {
        field: 'operation',
        value: POST_EDIT_OPS,
        and: { field: 'mode', value: 'customScheduled' },
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp (e.g. 2026-08-01T15:00:00Z) for when the post should publish. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },

    // Media attachment (basic upload / advanced reference or URL)
    {
      id: 'mediaUpload',
      title: 'Media',
      type: 'file-upload',
      canonicalParamId: 'media',
      acceptedTypes: 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime',
      mode: 'basic',
      multiple: false,
      condition: { field: 'operation', value: POST_EDIT_OPS },
    },
    {
      id: 'mediaRef',
      title: 'Media',
      type: 'short-input',
      canonicalParamId: 'media',
      placeholder: 'Public image/video URL or a file reference from a previous block',
      mode: 'advanced',
      condition: { field: 'operation', value: POST_EDIT_OPS },
    },
    {
      id: 'mediaAltText',
      title: 'Media Alt Text',
      type: 'short-input',
      placeholder: 'Describe the attached image',
      mode: 'advanced',
      condition: { field: 'operation', value: POST_EDIT_OPS },
    },
    {
      id: 'schedulingType',
      title: 'Scheduling Type',
      type: 'dropdown',
      options: [
        { label: 'Automatic (Buffer publishes)', id: 'automatic' },
        { label: 'Notification (mobile reminder)', id: 'notification' },
      ],
      value: () => 'automatic',
      mode: 'advanced',
      condition: { field: 'operation', value: POST_EDIT_OPS },
    },
    {
      id: 'saveToDraft',
      title: 'Save as Draft',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: POST_EDIT_OPS },
    },

    // Get Posts filters
    {
      id: 'channelIds',
      title: 'Channel IDs',
      type: 'short-input',
      placeholder: 'Comma-separated channel IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_posts' },
    },
    {
      id: 'status',
      title: 'Status Filter',
      type: 'short-input',
      placeholder: 'e.g. scheduled,sent (draft, needs_approval, scheduled, sending, sent, error)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_posts' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Maximum results to return (default 20)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_posts', 'get_ideas'] },
    },
    {
      id: 'after',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'pageInfo.endCursor from a previous page',
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_posts', 'get_ideas'] },
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Due date', id: 'dueAt' },
        { label: 'Created date', id: 'createdAt' },
      ],
      value: () => 'dueAt',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_posts' },
    },
    {
      id: 'sortDirection',
      title: 'Sort Direction',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      value: () => 'asc',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_posts' },
    },

    // Idea fields
    {
      id: 'title',
      title: 'Idea Title',
      type: 'short-input',
      placeholder: 'Optional title for the idea',
      condition: { field: 'operation', value: 'create_idea' },
    },
    {
      id: 'groupId',
      title: 'Idea Group ID',
      type: 'short-input',
      placeholder: 'Optional idea group (board column)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_idea' },
    },

    // Credential
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Buffer API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'buffer_create_post',
      'buffer_edit_post',
      'buffer_get_posts',
      'buffer_get_post',
      'buffer_delete_post',
      'buffer_get_channels',
      'buffer_create_idea',
      'buffer_get_ideas',
      'buffer_get_idea_groups',
      'buffer_get_account',
    ],
    config: {
      tool: (params) => `buffer_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(params)) {
          if (key === 'media') continue
          if (value === undefined || value === null || value === '') continue
          if (key === 'limit') {
            const limit = Number(value)
            if (Number.isFinite(limit)) result.limit = limit
            continue
          }
          result[key] = value
        }

        // Collapse basic/advanced media inputs into a single file reference,
        // passing plain URL strings (advanced mode) through untouched. JSON-ish
        // strings that normalize to nothing (e.g. "[]" from an empty file
        // reference) are dropped rather than treated as URLs.
        const media = params.media
        const normalizedMedia = normalizeFileInput(media, { single: true })
        if (normalizedMedia) {
          result.media = normalizedMedia
        } else if (typeof media === 'string' && media.trim() !== '') {
          const trimmed = media.trim()
          let parsesAsJson = true
          try {
            JSON.parse(trimmed)
          } catch {
            parsesAsJson = false
          }
          if (!parsesAsJson) result.media = trimmed
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Buffer API key' },
    channelId: { type: 'string', description: 'Channel to create the post for' },
    postId: { type: 'string', description: 'Post ID' },
    organizationId: { type: 'string', description: 'Buffer organization ID' },
    text: { type: 'string', description: 'Post or idea text content' },
    mode: {
      type: 'string',
      description: 'Share mode (addToQueue, shareNext, shareNow, customScheduled)',
    },
    schedulingType: { type: 'string', description: 'Scheduling type (automatic or notification)' },
    dueAt: { type: 'string', description: 'Publish time (ISO 8601)' },
    saveToDraft: { type: 'boolean', description: 'Save the post as a draft' },
    media: { type: 'string', description: 'Image or video attachment (file or public URL)' },
    mediaAltText: { type: 'string', description: 'Alt text for an attached image' },
    channelIds: { type: 'string', description: 'Comma-separated channel IDs filter' },
    status: { type: 'string', description: 'Comma-separated post status filter' },
    limit: { type: 'number', description: 'Maximum posts to return' },
    after: { type: 'string', description: 'Pagination cursor' },
    sortBy: { type: 'string', description: 'Sort field (dueAt or createdAt)' },
    sortDirection: { type: 'string', description: 'Sort direction (asc or desc)' },
    title: { type: 'string', description: 'Idea title' },
    groupId: { type: 'string', description: 'Idea group ID' },
  },

  outputs: {
    post: { type: 'json', description: 'A single post' },
    posts: { type: 'json', description: 'List of posts' },
    pageInfo: { type: 'json', description: 'Pagination info for the next page' },
    channels: { type: 'json', description: 'List of connected channels' },
    account: { type: 'json', description: 'Account details with organizations' },
    idea: { type: 'json', description: 'The created idea' },
    ideas: { type: 'json', description: 'List of content ideas' },
    ideaGroups: { type: 'json', description: 'List of idea groups (board columns)' },
    deleted: { type: 'boolean', description: 'Whether the post was deleted' },
    id: { type: 'string', description: 'ID of the deleted post' },
  },
}

export const BufferBlockMeta = {
  tags: ['marketing', 'scheduling', 'automation'],
  url: 'https://buffer.com',
  templates: [
    {
      icon: BufferIcon,
      title: 'Blog post to social queue',
      prompt:
        'Build a workflow that takes a blog post URL and summary, writes a short social caption for it, and adds a Buffer post to the queue for each connected channel returned by Get Channels.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: BufferIcon,
      title: 'Weekly content calendar',
      prompt:
        "Create a workflow that reads next week's content calendar from a table and creates a custom-scheduled Buffer post for each row with its channel, caption, and publish time, then writes the new post IDs back to the table.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'scheduling'],
    },
    {
      icon: BufferIcon,
      title: 'Image post from generated art',
      prompt:
        'Build a workflow that generates an on-brand image with an AI image model, writes a matching caption, and creates a Buffer post with the image attached, scheduled for tomorrow morning.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'image-generation'],
    },
    {
      icon: BufferIcon,
      title: 'Failed post alert to Slack',
      prompt:
        'Create a scheduled workflow that lists Buffer posts with status error, and for each failed post sends a Slack alert with the channel, the post text, and the publishing error message so the team can fix and reschedule it.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BufferIcon,
      title: 'Daily queue health check',
      prompt:
        'Build a scheduled daily workflow that gets all Buffer channels, flags any with a paused queue or disconnected account, counts scheduled posts per channel for the next 3 days, and emails a digest highlighting channels with an empty queue.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
    },
    {
      icon: BufferIcon,
      title: 'Capture ideas from Slack',
      prompt:
        'Create a workflow triggered by a Slack message in the content-ideas channel that cleans up the message text and saves it as a Buffer idea with a short title so the marketing team can draft it later.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BufferIcon,
      title: 'Product launch announcement',
      prompt:
        'Build a workflow that takes launch notes, writes a tailored announcement per social network, and shares a Buffer post immediately on every connected channel, then reports the external links of the published posts.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: BufferIcon,
      title: 'Evergreen content recycler',
      prompt:
        'Create a scheduled weekly workflow that lists Buffer posts sent more than 90 days ago, picks the top evergreen ones, refreshes their captions, and re-adds them to the queue as new posts.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'scheduling', 'automation'],
    },
  ],
  skills: [
    {
      name: 'schedule-social-post',
      description:
        'Create and schedule a Buffer post on a channel — queued, shared immediately, or at a specific time. Use to publish content to social media.',
      content:
        '# Schedule Social Post\n\nPublish or schedule a post on a connected Buffer channel.\n\n## Steps\n1. If the channel ID is unknown, use Get Account to find the organization ID, then Get Channels to list channels and pick the right one.\n2. Use Create Post with the channel ID and the post text.\n3. Pick the share mode: addToQueue (next open queue slot), shareNext (front of the queue), shareNow (publish immediately), or customScheduled with an ISO 8601 dueAt time.\n4. Optionally attach an image or video (uploaded file or public URL) and set alt text for images.\n\n## Output\nReturn the new post id, its status, the channel, and the scheduled time (dueAt) so the user knows when it will publish.',
    },
    {
      name: 'post-with-media',
      description:
        'Attach an image or video to a Buffer post from an uploaded file, a previous block output, or a public URL. Use for visual content.',
      content:
        '# Post With Media\n\nCreate a Buffer post with an image or video attachment.\n\n## Steps\n1. Provide the media as an uploaded file, a file reference from a previous block (e.g. an image-generation output), or a publicly accessible URL.\n2. Use Create Post with the channel ID, caption text, and the media input — Buffer detects images vs videos automatically.\n3. For images, set alt text to keep posts accessible.\n4. Choose the share mode and, for customScheduled, the dueAt publish time.\n\n## Output\nReturn the post id, status, and the attached asset details (type and source URL) from the response.',
    },
    {
      name: 'review-post-queue',
      description:
        'List scheduled, draft, sent, or failed posts across channels with pagination. Use to inspect what is coming up or what already went out.',
      content:
        '# Review Post Queue\n\nInspect posts in a Buffer organization.\n\n## Steps\n1. Use Get Account to find the organization ID if unknown.\n2. Use Get Posts with the organization ID; filter by comma-separated channel IDs and statuses (draft, needs_approval, scheduled, sending, sent, error).\n3. Sort by dueAt ascending to see the upcoming schedule, or createdAt descending for recent activity.\n4. Page through results with pageInfo.endCursor passed as the cursor until hasNextPage is false.\n\n## Output\nReturn a concise list per post: id, channel service, status, due/sent time, and a text preview. Note any posts in error status.',
    },
    {
      name: 'fix-failed-posts',
      description:
        'Find Buffer posts that failed to publish, read their errors, and reschedule them. Use to recover from publishing failures.',
      content:
        "# Fix Failed Posts\n\nRecover posts that failed to publish.\n\n## Steps\n1. Use Get Posts filtered to status error to find failed posts.\n2. Read each post's error message (and support URL) to understand why it failed.\n3. If the content needs adjusting, use Edit Post to update the text or media.\n4. Reschedule by editing the post with mode addToQueue or customScheduled and a new dueAt, or delete it with Delete Post if it is no longer wanted.\n\n## Output\nReturn a summary per failed post: the failure reason and the action taken (rescheduled, edited, or deleted).",
    },
    {
      name: 'capture-content-idea',
      description:
        "Save a content idea to Buffer's ideas board for later drafting. Use when inspiration arrives before it is ready to schedule.",
      content:
        "# Capture Content Idea\n\nSave rough content to Buffer's ideas board.\n\n## Steps\n1. Use Get Account to find the organization ID if unknown.\n2. Use Create Idea with the organization ID and the idea text; add a short title so it is easy to scan on the board.\n3. Optionally place it in a specific idea group (board column) — use Get Idea Groups to find the group ID.\n\n## Output\nReturn the idea id and title, and confirm it is saved on the ideas board ready to be drafted into posts.",
    },
  ],
} as const satisfies BlockMeta
