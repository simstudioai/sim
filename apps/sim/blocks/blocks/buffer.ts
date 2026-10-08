import { BufferIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta, SubBlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import { getToolMetadata } from '@/tools/metadata'

const POST_EDIT_OPS = ['create_post', 'edit_post']
const ORG_OPS = [
  'get_posts',
  'get_channels',
  'create_idea',
  'get_ideas',
  'get_idea_groups',
  'get_aggregated_post_metrics',
]

function jsonWand(
  toolId: string,
  field: string,
  example: string,
  placeholder: string
): NonNullable<SubBlockConfig['wandConfig']> {
  return {
    enabled: true,
    generationType: example.trim().startsWith('[') ? 'json-array' : 'json-object',
    prompt: `Generate the Buffer ${field} input requested by the user. Follow this input contract: ${getToolMetadata(toolId)?.params[field]?.description ?? ''}. Example: ${example}. Use only resource IDs and URLs supplied by the user. Return ONLY the JSON.`,
    placeholder,
  }
}

function timestampWand(purpose: string): NonNullable<SubBlockConfig['wandConfig']> {
  return {
    enabled: true,
    generationType: 'timestamp',
    prompt: `Generate an ISO 8601 timestamp with timezone for ${purpose}. Return ONLY the ISO 8601 timestamp string.`,
    placeholder: 'For example, yesterday at midnight UTC',
  }
}

export const BufferBlock: BlockConfig = {
  type: 'buffer',
  name: 'Buffer',
  description: 'Schedule and publish social media posts across connected channels',
  longDescription:
    'Integrate Buffer into your workflow. Create, schedule, edit, and delete posts across connected social channels (Instagram, LinkedIn, X, Facebook, TikTok, and more), attach images or videos, browse channel settings, check daily limits and post metrics, and capture content ideas using the Buffer API.',
  docsLink: 'https://docs.sim.ai/integrations/buffer',
  category: 'tools',
  integrationType: IntegrationType.Marketing,
  bgColor: '#FFFFFF',
  icon: BufferIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Buffer',
    sentences: {
      byOperation: {
        create_post: [
          { text: 'Create a post on channel', field: 'channelId', core: true },
          { text: ', saying', field: 'text' },
          { text: ', publishing at', field: 'dueAt' },
        ],
        edit_post: [
          { text: 'Update post', field: 'postId', core: true },
          { text: ', to say', field: 'text' },
          { text: ', rescheduled for', field: 'dueAt' },
        ],
        get_posts: [
          'List posts',
          { text: ', on channels', field: 'channelIds' },
          { text: ', with status', field: 'status' },
          { text: ', up to', field: 'limit' },
        ],
        get_post: [{ text: 'Fetch post', field: 'postId', core: true }],
        delete_post: [{ text: 'Delete post', field: 'postId', core: true }],
        get_channels: ['List connected channels'],
        get_channel: [{ text: 'Fetch channel', field: 'channelId', core: true }],
        get_aggregated_post_metrics: [
          'Aggregate post metrics',
          { text: ', starting', field: 'startDateTime', core: true },
          { text: ', ending', field: 'endDateTime', core: true },
        ],
        get_daily_posting_limits: [
          { text: 'Check daily limits on channels', field: 'channelIds', core: true },
          { text: ', for', field: 'date' },
        ],
        create_idea: [
          { text: 'Save idea', field: 'text', core: true },
          { text: ', titled', field: 'title' },
          { text: ', to group', field: 'groupId' },
        ],
        get_ideas: ['List saved ideas', { text: ', up to', field: 'limit' }],
        get_idea_groups: ['List idea groups'],
        get_account: ['Read the authenticated account'],
      },
    },
  },

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
        { label: 'Get Channel', id: 'get_channel' },
        { label: 'Get Aggregated Post Metrics', id: 'get_aggregated_post_metrics' },
        { label: 'Get Daily Posting Limits', id: 'get_daily_posting_limits' },
        { label: 'Create Idea', id: 'create_idea' },
        { label: 'Get Ideas', id: 'get_ideas' },
        { label: 'Get Idea Groups', id: 'get_idea_groups' },
        { label: 'Get Account', id: 'get_account' },
      ],
      value: () => 'create_post',
    },

    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      placeholder: 'Find channel IDs with the Get Channels operation',
      condition: { field: 'operation', value: ['create_post', 'get_channel'] },
      required: { field: 'operation', value: ['create_post', 'get_channel'] },
    },

    {
      id: 'postId',
      title: 'Post ID',
      type: 'short-input',
      placeholder: 'Enter the Buffer post ID',
      condition: { field: 'operation', value: ['edit_post', 'get_post', 'delete_post'] },
      required: { field: 'operation', value: ['edit_post', 'get_post', 'delete_post'] },
    },

    {
      id: 'organizationId',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Find organization IDs with the Get Account operation',
      condition: {
        field: 'operation',
        value: ORG_OPS,
      },
      required: {
        field: 'operation',
        value: ORG_OPS,
      },
    },

    {
      id: 'text',
      title: 'Text',
      type: 'long-input',
      placeholder: 'What would you like to share?',
      condition: { field: 'operation', value: [...POST_EDIT_OPS, 'create_idea'] },
    },
    {
      id: 'mode',
      title: 'Share Mode',
      type: 'dropdown',
      options: (params) => [
        {
          label:
            params?.values.operation === 'edit_post'
              ? 'Keep current schedule'
              : 'Default (add to queue)',
          id: 'default',
        },
        { label: 'Add to queue', id: 'addToQueue' },
        { label: 'Share next', id: 'shareNext' },
        { label: 'Share now', id: 'shareNow' },
        { label: 'Custom schedule', id: 'customScheduled' },
      ],
      value: () => 'default',
      condition: { field: 'operation', value: POST_EDIT_OPS },
      required: { field: 'operation', value: 'create_post' },
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
        placeholder: 'For example, next Friday at 3pm UTC',
      },
    },

    {
      id: 'mediaUpload',
      title: 'Media',
      type: 'file-upload',
      canonicalParamId: 'mediaSource',
      acceptedTypes: 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime',
      mode: 'basic',
      multiple: false,
      condition: { field: 'operation', value: POST_EDIT_OPS },
    },
    {
      id: 'mediaRef',
      title: 'Media',
      type: 'short-input',
      canonicalParamId: 'mediaSource',
      placeholder: 'Reference a file from a previous block',
      mode: 'advanced',
      condition: { field: 'operation', value: POST_EDIT_OPS },
    },
    {
      id: 'mediaUrl',
      title: 'Media URL',
      type: 'short-input',
      placeholder: 'Public image or video URL',
      description: 'Alternative to Media.',
      mode: 'advanced',
      condition: { field: 'operation', value: POST_EDIT_OPS },
    },
    {
      id: 'mediaType',
      title: 'Media Type',
      type: 'dropdown',
      options: [
        { label: 'Auto-detect', id: 'auto' },
        { label: 'Image', id: 'image' },
        { label: 'Video', id: 'video' },
      ],
      value: () => 'auto',
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
      options: (params) => [
        {
          label:
            params?.values.operation === 'edit_post'
              ? 'Keep current publishing method'
              : 'Default (automatic)',
          id: 'default',
        },
        { label: 'Automatic (Buffer publishes)', id: 'automatic' },
        { label: 'Notification (mobile reminder)', id: 'notification' },
      ],
      value: () => 'default',
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

    {
      id: 'channelIds',
      title: 'Channel IDs',
      type: 'short-input',
      wandConfig: {
        enabled: true,
        prompt:
          'Format the channel IDs supplied by the user as a comma-separated list. Do not invent IDs. Return ONLY the comma-separated IDs.',
        placeholder: 'Paste the channel IDs to include',
      },
      placeholder: 'Comma-separated channel IDs',
      condition: {
        field: 'operation',
        value: ['get_posts', 'get_aggregated_post_metrics', 'get_daily_posting_limits'],
      },
      required: { field: 'operation', value: 'get_daily_posting_limits' },
    },
    {
      id: 'status',
      title: 'Status Filter',
      type: 'short-input',
      placeholder: 'e.g. scheduled,sent (draft, needs_approval, scheduled, sending, sent, error)',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Choose Buffer post statuses for the request from draft, needs_approval, scheduled, sending, sent, error. Return ONLY the comma-separated statuses.',
        placeholder: 'For example, scheduled posts and failed posts',
      },
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

    {
      id: 'assets',
      title: 'Assets',
      type: 'code',
      language: 'json',
      placeholder: '[]',
      wandConfig: jsonWand(
        'buffer_create_post',
        'assets',
        '[{"image":{"url":"https://example.com/image.png"}}]',
        'Describe the media assets and provide their URLs'
      ),
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_post', 'edit_post'] },
    },
    {
      id: 'metadata',
      title: 'Network Metadata',
      type: 'code',
      language: 'json',
      placeholder: '{"instagram":{"type":"post","shouldShareToFeed":true}}',
      wandConfig: jsonWand(
        'buffer_create_post',
        'metadata',
        '{"linkedin":{"firstComment":"Learn more"}}',
        'Describe the network and its post settings'
      ),
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_post', 'edit_post'] },
    },
    {
      id: 'aiAssisted',
      title: 'AI Assisted',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_post', 'edit_post'] },
    },
    {
      id: 'needsApproval',
      title: 'Needs Approval',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_post'] },
    },
    {
      id: 'approvalChange',
      title: 'Approval Change',
      type: 'dropdown',
      options: [
        { label: 'Keep approval state', id: 'default' },
        { label: 'Request approval', id: 'request' },
        { label: 'Withdraw request', id: 'revert' },
      ],
      value: () => 'default',
      mode: 'advanced',
      condition: { field: 'operation', value: ['edit_post'] },
    },
    {
      id: 'draftId',
      title: 'Draft ID',
      type: 'short-input',
      placeholder: 'Source draft ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_post', 'edit_post'] },
    },
    {
      id: 'ideaId',
      title: 'Idea ID',
      type: 'short-input',
      placeholder: 'Source idea ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_post', 'edit_post'] },
    },
    {
      id: 'source',
      title: 'Source',
      type: 'short-input',
      placeholder: 'Source application',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_post', 'edit_post'] },
    },
    {
      id: 'tagIds',
      title: 'Tag IDs',
      type: 'code',
      language: 'json',
      placeholder: '[]',
      wandConfig: jsonWand('buffer_edit_post', 'tagIds', '[]', 'Paste the tag IDs to apply'),
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_post', 'edit_post'] },
    },
    {
      id: 'filter',
      title: 'Filters',
      type: 'code',
      language: 'json',
      placeholder: '{}',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt: `Generate a Buffer filter for the operation specified by the user. Post filters: ${getToolMetadata('buffer_get_posts')?.params.filter?.description ?? ''}. Channel filters: ${getToolMetadata('buffer_get_channels')?.params.filter?.description ?? ''}. Example post filter: {"status":["draft"]}. Example channel filter: {"isLocked":false}. Use only IDs supplied by the user. Return ONLY the JSON object.`,
        placeholder: 'Describe the posts or channels to include',
      },
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_posts', 'get_channels'] },
    },
    {
      id: 'sort',
      title: 'Sort Keys',
      type: 'code',
      language: 'json',
      placeholder: '[{"field":"dueAt","direction":"asc"}]',
      wandConfig: jsonWand(
        'buffer_get_posts',
        'sort',
        '[{"field":"dueAt","direction":"asc"}]',
        'Describe the order for the posts'
      ),
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_posts'] },
    },
    {
      id: 'organizationFilter',
      title: 'Organization Filter',
      type: 'code',
      language: 'json',
      placeholder: '{"organizationId":"..."}',
      wandConfig: jsonWand(
        'buffer_get_account',
        'organizationFilter',
        '{"organizationId":"provided-id"}',
        'Provide the organization ID to include'
      ),
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_account'] },
    },
    {
      id: 'content',
      title: 'Idea Content',
      type: 'code',
      language: 'json',
      placeholder: '{"title":"Idea title","text":"Idea content"}',
      wandConfig: jsonWand(
        'buffer_create_idea',
        'content',
        '{"title":"Idea title","text":"Idea content"}',
        'Describe the idea and any media to attach'
      ),
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_idea'] },
    },
    {
      id: 'group',
      title: 'Idea Group Placement',
      type: 'code',
      language: 'json',
      placeholder: '{"groupId":"...","placeAfterId":"..."}',
      wandConfig: jsonWand(
        'buffer_create_idea',
        'group',
        '{"groupId":"provided-id"}',
        'Provide the group ID and where to place the idea'
      ),
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_idea'] },
    },
    {
      id: 'cta',
      title: 'Call to Action',
      type: 'short-input',
      placeholder: 'Optional tracking value',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_idea'] },
    },
    {
      id: 'templateId',
      title: 'Template ID',
      type: 'short-input',
      placeholder: 'Optional source template ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_idea'] },
    },
    {
      id: 'groupFilter',
      title: 'Idea Group Filter',
      type: 'code',
      language: 'json',
      placeholder: '{"membership":"ungrouped"}',
      wandConfig: jsonWand(
        'buffer_get_ideas',
        'groupFilter',
        '{"membership":"ungrouped"}',
        'Describe which idea groups to include'
      ),
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_ideas'] },
    },
    {
      id: 'tagsFilter',
      title: 'Idea Tag Filter',
      type: 'code',
      language: 'json',
      placeholder: '{"in":[],"isEmpty":true}',
      wandConfig: jsonWand(
        'buffer_get_ideas',
        'tagsFilter',
        '{"in":[],"isEmpty":true}',
        'Provide tag IDs or request untagged ideas'
      ),
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_ideas'] },
    },
    {
      id: 'tags',
      title: 'Metric Tag Filter',
      type: 'code',
      language: 'json',
      placeholder: '{"in":[],"isEmpty":true}',
      wandConfig: jsonWand(
        'buffer_get_aggregated_post_metrics',
        'tags',
        '{"in":[],"isEmpty":true}',
        'Provide tag IDs or request untagged posts'
      ),
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_aggregated_post_metrics'] },
    },
    {
      id: 'startDateTime',
      title: 'Metrics Start Time',
      type: 'short-input',
      placeholder: '2026-10-01T00:00:00Z',
      wandConfig: timestampWand('the start of the metrics window'),
      required: true,
      condition: { field: 'operation', value: ['get_aggregated_post_metrics'] },
    },
    {
      id: 'endDateTime',
      title: 'Metrics End Time',
      type: 'short-input',
      placeholder: '2026-10-07T23:59:59Z',
      wandConfig: timestampWand('the end of the metrics window'),
      required: true,
      condition: { field: 'operation', value: ['get_aggregated_post_metrics'] },
    },
    {
      id: 'date',
      title: 'Limit Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp; defaults to today',
      wandConfig: timestampWand('the date to check daily posting limits'),
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_daily_posting_limits'] },
    },
    {
      id: 'clearText',
      title: 'Clear Caption',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['edit_post'] },
    },

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
      'buffer_get_channel',
      'buffer_get_aggregated_post_metrics',
      'buffer_get_daily_posting_limits',
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
          if (
            key === 'mediaSource' ||
            key === 'mediaUrl' ||
            key === 'clearText' ||
            key === 'operation'
          )
            continue
          if (value === undefined || value === null || value === '') {
            result[key] = undefined
            continue
          }
          if ((key === 'mode' || key === 'schedulingType') && value === 'default') {
            result[key] =
              params.operation === 'create_post'
                ? key === 'mode'
                  ? 'addToQueue'
                  : 'automatic'
                : undefined
            continue
          }
          if (key === 'approvalChange' && value === 'default') {
            result[key] = undefined
            continue
          }
          if (key === 'limit') {
            const limit = Number(value)
            if (Number.isFinite(limit)) result.limit = limit
            continue
          }
          result[key] = value
        }

        const normalizedMedia = normalizeFileInput(params.mediaSource, { single: true })
        const mediaUrl = typeof params.mediaUrl === 'string' ? params.mediaUrl.trim() : ''
        if (normalizedMedia && mediaUrl)
          throw new Error('Choose one media input: uploaded/reference file or public URL')
        if (params.assets && (normalizedMedia || mediaUrl))
          throw new Error('Choose assets or a single media input')
        if (params.operation === 'edit_post' && params.clearText === true) result.text = null
        if (normalizedMedia) {
          result.media = normalizedMedia
        } else if (mediaUrl) {
          result.media = mediaUrl
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
    mediaSource: { type: 'json', description: 'Image or video file to attach' },
    mediaUrl: { type: 'string', description: 'Public image or video URL to attach' },
    mediaType: {
      type: 'string',
      description: 'Attachment type override: auto, image, or video',
    },
    mediaAltText: { type: 'string', description: 'Alt text for an attached image' },
    channelIds: { type: 'string', description: 'Comma-separated channel IDs filter' },
    status: { type: 'string', description: 'Comma-separated post status filter' },
    limit: { type: 'number', description: 'Maximum posts to return' },
    after: { type: 'string', description: 'Pagination cursor' },
    sortBy: { type: 'string', description: 'Sort field (dueAt or createdAt)' },
    sortDirection: { type: 'string', description: 'Sort direction (asc or desc)' },
    title: { type: 'string', description: 'Idea title' },
    groupId: { type: 'string', description: 'Idea group ID' },
    assets: { type: 'json', description: 'Assets' },
    metadata: { type: 'json', description: 'Network Metadata' },
    aiAssisted: { type: 'boolean', description: 'AI Assisted' },
    needsApproval: { type: 'boolean', description: 'Needs Approval' },
    approvalChange: { type: 'string', description: 'Approval Change' },
    draftId: { type: 'string', description: 'Draft ID' },
    ideaId: { type: 'string', description: 'Idea ID' },
    source: { type: 'string', description: 'Source' },
    tagIds: { type: 'json', description: 'Tag IDs' },
    filter: { type: 'json', description: 'Filters' },
    sort: { type: 'json', description: 'Sort Keys' },
    organizationFilter: { type: 'json', description: 'Organization Filter' },
    content: { type: 'json', description: 'Idea Content' },
    group: { type: 'json', description: 'Idea Group Placement' },
    cta: { type: 'string', description: 'Call to Action' },
    templateId: { type: 'string', description: 'Template ID' },
    groupFilter: { type: 'json', description: 'Idea Group Filter' },
    tagsFilter: { type: 'json', description: 'Idea Tag Filter' },
    tags: { type: 'json', description: 'Metric Tag Filter' },
    startDateTime: { type: 'string', description: 'Metrics Start Time' },
    endDateTime: { type: 'string', description: 'Metrics End Time' },
    date: { type: 'string', description: 'Limit Date' },
    clearText: { type: 'boolean', description: 'Clear Caption' },
  },

  outputs: {
    channel: {
      type: 'json',
      description: 'Channel identity, network metadata, posting schedule, actions and limits',
    },
    aggregatedPostMetrics: {
      type: 'json',
      description: 'Aggregated metrics and refresh timestamp',
    },
    limits: {
      type: 'json',
      description: 'Daily limits per channel (channelId, limit, scheduled, sent, isAtLimit)',
    },
    edges: { type: 'json', description: 'Cursor and full node for each listed post or idea' },
    post: {
      type: 'json',
      description: 'Post content, channel, assets, metadata, metrics, tags, notes and scheduling',
    },
    posts: {
      type: 'json',
      description:
        'Posts with content, channel, assets, metadata, metrics, tags, notes and scheduling',
    },
    pageInfo: {
      type: 'json',
      description: 'Cursor pagination (startCursor, endCursor, hasNextPage, hasPreviousPage)',
    },
    channels: {
      type: 'json',
      description: 'Channels with network metadata, schedules, actions and limits',
    },
    account: {
      type: 'json',
      description: 'Account identity, organizations, preferences and connected apps',
    },
    idea: {
      type: 'json',
      description: 'Created idea with content, group placement and timestamps',
    },
    ideas: { type: 'json', description: 'Ideas with content, group placement and timestamps' },
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
      title: 'Buffer blog-to-social queue',
      prompt:
        'Build a workflow that takes a blog post URL and summary, writes a short social caption for it, and adds a Buffer post to the queue for each connected channel returned by Get Channels.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: BufferIcon,
      title: 'Buffer weekly content calendar',
      prompt:
        "Create a workflow that reads next week's content calendar from a table and creates a custom-scheduled Buffer post for each row with its channel, caption, and publish time, then writes the new post IDs back to the table.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'scheduling'],
    },
    {
      icon: BufferIcon,
      title: 'Buffer post from generated art',
      prompt:
        'Build a workflow that generates an on-brand image with an AI image model, writes a matching caption, and creates a Buffer post with the image attached, scheduled for tomorrow morning.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'image-generation'],
    },
    {
      icon: BufferIcon,
      title: 'Buffer failed-post alert to Slack',
      prompt:
        'Create a scheduled workflow that lists Buffer posts with status error, and for each failed post sends a Slack alert with the channel, the post text, and the publishing error message so the team can fix and reschedule it.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BufferIcon,
      title: 'Buffer daily queue health check',
      prompt:
        'Build a scheduled daily workflow that gets all Buffer channels, flags any with a paused queue or disconnected account, counts scheduled posts per channel for the next 3 days, and emails a digest highlighting channels with an empty queue.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting'],
    },
    {
      icon: BufferIcon,
      title: 'Buffer ideas from Slack',
      prompt:
        'Create a workflow triggered by a Slack message in the content-ideas channel that cleans up the message text and saves it as a Buffer idea with a short title so the marketing team can draft it later.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BufferIcon,
      title: 'Buffer launch announcement',
      prompt:
        'Build a workflow that takes launch notes, writes a tailored announcement per social network, and shares a Buffer post immediately on every connected channel, then reports the external links of the published posts.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: BufferIcon,
      title: 'Buffer evergreen recycler',
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
