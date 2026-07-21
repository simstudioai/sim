import { BookOpen, ClipboardList, File, Table, Users } from '@sim/emcn/icons'
import { GoogleTranslateIcon, GreptileIcon, SlackIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta, SubBlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { SlackResponse } from '@/tools/slack/types'
import { getTrigger } from '@/triggers'

export const SlackBlock: BlockConfig<SlackResponse> = {
  type: 'slack',
  name: 'Slack',
  description:
    'Send, update, delete messages, manage views and modals, add or remove reactions, manage canvases, get channel info and user presence in Slack',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Slack into the workflow. Can send, update, and delete messages, send ephemeral messages visible only to a specific user, open/update/push modal views, publish Home tab views, create canvases, read messages, and add or remove reactions. Requires Bot Token instead of OAuth in advanced mode. Can be used in trigger mode to trigger a workflow when a message is sent to a channel.',
  docsLink: 'https://docs.sim.ai/integrations/slack',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  bgColor: '#611f69',
  icon: SlackIcon,
  triggerAllowed: true,
  // Superseded by slack_v2, but stays discoverable until v2 GAs — hiding both
  // would leave no Slack block in the toolbar while v2 is preview-gated. At v2
  // GA this becomes `hideFromToolbar: true` (superseded-version paradigm).
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Message', id: 'send' },
        { label: 'Send Ephemeral Message', id: 'ephemeral' },
        { label: 'Create Canvas', id: 'canvas' },
        { label: 'Read Messages', id: 'read' },
        { label: 'Get Message', id: 'get_message' },
        { label: 'Get Thread', id: 'get_thread' },
        { label: 'Get Thread Replies', id: 'get_thread_replies' },
        { label: 'Get Channel History', id: 'get_channel_history' },
        { label: 'Get Message Permalink', id: 'get_permalink' },
        { label: 'Set Assistant Status', id: 'set_status' },
        { label: 'Set Assistant Title', id: 'set_title' },
        { label: 'Set Suggested Prompts', id: 'set_suggested_prompts' },
        { label: 'List Channels', id: 'list_channels' },
        { label: 'List Channel Members', id: 'list_members' },
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User Info', id: 'get_user' },
        { label: 'Download File', id: 'download' },
        { label: 'Update Message', id: 'update' },
        { label: 'Delete Message', id: 'delete' },
        { label: 'Add Reaction', id: 'react' },
        { label: 'Remove Reaction', id: 'unreact' },
        { label: 'Get Channel Info', id: 'get_channel_info' },
        { label: 'Get User Presence', id: 'get_user_presence' },
        { label: 'Edit Canvas', id: 'edit_canvas' },
        { label: 'Create Channel Canvas', id: 'create_channel_canvas' },
        { label: 'Get Canvas Info', id: 'get_canvas' },
        { label: 'List Canvases', id: 'list_canvases' },
        { label: 'Lookup Canvas Sections', id: 'lookup_canvas_sections' },
        { label: 'Delete Canvas', id: 'delete_canvas' },
        { label: 'Create Conversation', id: 'create_conversation' },
        { label: 'Invite to Conversation', id: 'invite_to_conversation' },
        { label: 'Open View', id: 'open_view' },
        { label: 'Update View', id: 'update_view' },
        { label: 'Push View', id: 'push_view' },
        { label: 'Publish View', id: 'publish_view' },
        { label: 'Schedule Message', id: 'schedule_message' },
        { label: 'List Scheduled Messages', id: 'list_scheduled_messages' },
        { label: 'Delete Scheduled Message', id: 'delete_scheduled_message' },
        { label: 'Archive Conversation', id: 'archive_conversation' },
        { label: 'Rename Conversation', id: 'rename_conversation' },
        { label: 'Set Conversation Topic', id: 'set_conversation_topic' },
        { label: 'Set Conversation Purpose', id: 'set_conversation_purpose' },
      ],
      value: () => 'send',
    },
    {
      id: 'authMethod',
      title: 'Authentication Method',
      type: 'dropdown',
      options: [
        { label: 'Sim Bot', id: 'oauth' },
        { label: 'Custom Bot', id: 'bot_token' },
      ],
      value: () => 'oauth',
      required: true,
    },
    {
      id: 'destinationType',
      title: 'Destination',
      type: 'dropdown',
      options: [
        { label: 'Channel', id: 'channel' },
        { label: 'Direct Message', id: 'dm' },
      ],
      value: () => 'channel',
      condition: {
        field: 'operation',
        value: ['send', 'read', 'schedule_message'],
      },
    },
    {
      id: 'credential',
      title: 'Slack Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'slack',
      requiredScopes: getScopesForService('slack'),
      placeholder: 'Select Slack workspace',
      dependsOn: ['authMethod'],
      condition: {
        field: 'authMethod',
        value: 'oauth',
      },
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Slack Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      dependsOn: ['authMethod'],
      condition: {
        field: 'authMethod',
        value: 'oauth',
      },
      required: true,
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      placeholder: 'Enter your Slack bot token (xoxb-...)',
      password: true,
      dependsOn: ['authMethod'],
      condition: {
        field: 'authMethod',
        value: 'bot_token',
      },
      required: true,
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'channel-selector',
      canonicalParamId: 'channel',
      serviceId: 'slack',
      selectorKey: 'slack.channels',
      placeholder: 'Select Slack channel',
      mode: 'basic',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      condition: (values?: Record<string, unknown>) => {
        const op = values?.operation as string
        if (op === 'ephemeral') {
          return { field: 'operation', value: 'ephemeral' }
        }
        return {
          field: 'operation',
          value: [
            'list_channels',
            'list_users',
            'get_user',
            'get_user_presence',
            'edit_canvas',
            'get_canvas',
            'lookup_canvas_sections',
            'delete_canvas',
            'create_conversation',
            'open_view',
            'update_view',
            'push_view',
            'publish_view',
          ],
          not: true,
          and: {
            field: 'destinationType',
            value: 'dm',
            not: true,
          },
        }
      },
      required: {
        field: 'operation',
        value: ['list_canvases', 'list_scheduled_messages'],
        not: true,
      },
    },
    {
      id: 'manualChannel',
      title: 'Channel ID',
      type: 'short-input',
      canonicalParamId: 'channel',
      placeholder: 'Enter Slack channel ID (e.g., C1234567890)',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      mode: 'advanced',
      condition: (values?: Record<string, unknown>) => {
        const op = values?.operation as string
        if (op === 'ephemeral') {
          return { field: 'operation', value: 'ephemeral' }
        }
        return {
          field: 'operation',
          value: [
            'list_channels',
            'list_users',
            'get_user',
            'get_user_presence',
            'edit_canvas',
            'get_canvas',
            'lookup_canvas_sections',
            'delete_canvas',
            'create_conversation',
            'open_view',
            'update_view',
            'push_view',
            'publish_view',
          ],
          not: true,
          and: {
            field: 'destinationType',
            value: 'dm',
            not: true,
          },
        }
      },
      required: {
        field: 'operation',
        value: ['list_canvases', 'list_scheduled_messages'],
        not: true,
      },
    },
    {
      id: 'dmUserId',
      title: 'User',
      type: 'user-selector',
      canonicalParamId: 'dmUserId',
      serviceId: 'slack',
      selectorKey: 'slack.users',
      placeholder: 'Select Slack user',
      mode: 'basic',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      condition: {
        field: 'destinationType',
        value: 'dm',
      },
      required: true,
    },
    {
      id: 'manualDmUserId',
      title: 'User ID',
      type: 'short-input',
      canonicalParamId: 'dmUserId',
      placeholder: 'Enter Slack user ID (e.g., U1234567890)',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      mode: 'advanced',
      condition: {
        field: 'destinationType',
        value: 'dm',
      },
      required: true,
    },
    {
      id: 'ephemeralUser',
      title: 'Target User',
      type: 'user-selector',
      canonicalParamId: 'ephemeralUser',
      serviceId: 'slack',
      selectorKey: 'slack.users',
      placeholder: 'Select Slack user',
      mode: 'basic',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      condition: {
        field: 'operation',
        value: 'ephemeral',
      },
      required: true,
    },
    {
      id: 'manualEphemeralUser',
      title: 'Target User ID',
      type: 'short-input',
      canonicalParamId: 'ephemeralUser',
      placeholder: 'Enter Slack user ID (e.g., U1234567890)',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'ephemeral',
      },
      required: true,
    },
    {
      id: 'messageFormat',
      title: 'Message Format',
      type: 'dropdown',
      options: [
        { label: 'Plain Text', id: 'text' },
        { label: 'Block Kit', id: 'blocks' },
      ],
      value: () => 'text',
      condition: {
        field: 'operation',
        value: ['send', 'ephemeral', 'update', 'schedule_message'],
      },
    },
    {
      id: 'text',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Enter your message (supports Slack mrkdwn)',
      condition: {
        field: 'operation',
        value: ['send', 'ephemeral', 'schedule_message'],
        and: { field: 'messageFormat', value: 'blocks', not: true },
      },
      required: {
        field: 'operation',
        value: ['send', 'ephemeral', 'schedule_message'],
        and: { field: 'messageFormat', value: 'blocks', not: true },
      },
    },
    {
      id: 'blocks',
      title: 'Block Kit Blocks',
      type: 'code',
      language: 'json',
      placeholder: 'JSON array of Block Kit blocks',
      condition: {
        field: 'operation',
        value: ['send', 'ephemeral', 'update', 'schedule_message'],
        and: { field: 'messageFormat', value: 'blocks' },
      },
      required: {
        field: 'operation',
        value: ['send', 'ephemeral', 'update', 'schedule_message'],
        and: { field: 'messageFormat', value: 'blocks' },
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert at Slack Block Kit.
Generate ONLY a valid JSON array of Block Kit blocks based on the user's request.
The output MUST be a JSON array starting with [ and ending with ].

Current blocks: {context}

Available block types for messages:
- "section": Displays text with an optional accessory element. Text uses { "type": "mrkdwn", "text": "..." } or { "type": "plain_text", "text": "..." }.
- "header": Large text header. Text must be plain_text.
- "divider": A horizontal rule separator. No fields needed besides type.
- "image": Displays an image. Requires "image_url" and "alt_text".
- "context": Contextual info with an "elements" array of image and text objects.
- "actions": Interactive elements like buttons. Each button needs "type": "button", a "text" object, and an "action_id".
- "rich_text": Structured rich text with "elements" array of rich_text_section objects.

Example output:
[
  {
    "type": "header",
    "text": { "type": "plain_text", "text": "Order Confirmation" }
  },
  {
    "type": "section",
    "text": { "type": "mrkdwn", "text": "Your order *#1234* has been confirmed." }
  },
  { "type": "divider" },
  {
    "type": "actions",
    "elements": [
      {
        "type": "button",
        "text": { "type": "plain_text", "text": "View Order" },
        "action_id": "view_order",
        "url": "https://example.com/orders/1234"
      }
    ]
  }
]

You can reference workflow variables using angle brackets, e.g., <blockName.output>.
Do not include any explanations, markdown formatting, or other text outside the JSON array.`,
        placeholder: 'Describe the Block Kit layout you want to create...',
      },
    },
    {
      id: 'threadTs',
      title: 'Thread Timestamp',
      type: 'short-input',
      placeholder: 'Reply to thread (e.g., 1405894322.002768)',
      condition: {
        field: 'operation',
        value: ['send', 'ephemeral', 'schedule_message'],
      },
      required: false,
    },
    {
      id: 'attachmentFiles',
      title: 'Attachments',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload files to attach',
      condition: { field: 'operation', value: 'send' },
      mode: 'basic',
      multiple: true,
      required: false,
    },
    {
      id: 'files',
      title: 'File Attachments',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'Reference files from previous blocks',
      condition: { field: 'operation', value: 'send' },
      mode: 'advanced',
      required: false,
    },
    // Canvas specific fields
    {
      id: 'title',
      title: 'Canvas Title',
      type: 'short-input',
      placeholder: 'Enter canvas title',
      condition: {
        field: 'operation',
        value: 'canvas',
      },
      required: true,
    },
    {
      id: 'content',
      title: 'Canvas Content',
      type: 'long-input',
      placeholder: 'Enter canvas content (markdown supported)',
      condition: {
        field: 'operation',
        value: 'canvas',
      },
      required: true,
    },
    // Message Reader specific fields
    {
      id: 'limit',
      title: 'Message Limit',
      type: 'short-input',
      placeholder: '15',
      condition: {
        field: 'operation',
        value: 'read',
      },
    },
    // List Channels specific fields
    {
      id: 'includePrivate',
      title: 'Include Private Channels',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: {
        field: 'operation',
        value: 'list_channels',
      },
    },
    {
      id: 'channelLimit',
      title: 'Channel Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: 'list_channels',
      },
    },
    // List Members specific fields
    {
      id: 'memberLimit',
      title: 'Member Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: 'list_members',
      },
    },
    // List Users specific fields
    {
      id: 'includeDeleted',
      title: 'Include Deactivated Users',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: 'list_users',
      },
    },
    {
      id: 'userLimit',
      title: 'User Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: 'list_users',
      },
    },
    // Pagination cursor (shared across list_channels, list_members, list_users)
    {
      id: 'paginationCursor',
      title: 'Pagination Cursor',
      type: 'short-input',
      placeholder: 'next_cursor from a previous response',
      condition: {
        field: 'operation',
        value: ['list_channels', 'list_members', 'list_users'],
      },
      mode: 'advanced',
    },
    // Get User specific fields
    {
      id: 'userId',
      title: 'User',
      type: 'user-selector',
      canonicalParamId: 'userId',
      serviceId: 'slack',
      selectorKey: 'slack.users',
      placeholder: 'Select Slack user',
      mode: 'basic',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      condition: {
        field: 'operation',
        value: 'get_user',
      },
      required: true,
    },
    {
      id: 'manualUserId',
      title: 'User ID',
      type: 'short-input',
      canonicalParamId: 'userId',
      placeholder: 'Enter Slack user ID (e.g., U1234567890)',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'get_user',
      },
      required: true,
    },
    // Get Message specific fields
    {
      id: 'getMessageTimestamp',
      title: 'Message Timestamp',
      type: 'short-input',
      placeholder: 'Message timestamp (e.g., 1405894322.002768)',
      condition: {
        field: 'operation',
        value: ['get_message', 'get_permalink'],
      },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Extract or generate a Slack message timestamp from the user's input.
Slack message timestamps are in the format: XXXXXXXXXX.XXXXXX (seconds.microseconds since Unix epoch).
Examples:
- "1405894322.002768" -> 1405894322.002768 (already a valid timestamp)
- "thread_ts from the trigger" -> The user wants to reference a variable, output the original text
- A URL like "https://slack.com/archives/C123/p1405894322002768" -> Extract 1405894322.002768 (remove 'p' prefix, add decimal after 10th digit)

If the input looks like a reference to another block's output (contains < and >) or a variable, return it as-is.
Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Paste a Slack message URL or timestamp...',
        generationType: 'timestamp',
      },
    },
    // Get Thread specific fields
    {
      id: 'getThreadTimestamp',
      title: 'Thread Timestamp',
      type: 'short-input',
      placeholder: 'Thread timestamp (thread_ts, e.g., 1405894322.002768)',
      condition: {
        field: 'operation',
        value: [
          'get_thread',
          'get_thread_replies',
          'set_status',
          'set_title',
          'set_suggested_prompts',
        ],
      },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Extract or generate a Slack thread timestamp from the user's input.
Slack thread timestamps (thread_ts) are in the format: XXXXXXXXXX.XXXXXX (seconds.microseconds since Unix epoch).
Examples:
- "1405894322.002768" -> 1405894322.002768 (already a valid timestamp)
- "thread_ts from the trigger" -> The user wants to reference a variable, output the original text
- A URL like "https://slack.com/archives/C123/p1405894322002768" -> Extract 1405894322.002768 (remove 'p' prefix, add decimal after 10th digit)

If the input looks like a reference to another block's output (contains < and >) or a variable, return it as-is.
Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Paste a Slack thread URL or thread_ts...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'threadLimit',
      title: 'Message Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: 'get_thread',
      },
    },
    // Set Assistant Status specific fields
    {
      id: 'status',
      title: 'Status Text',
      type: 'short-input',
      placeholder: 'e.g., Working on it… (leave empty to clear)',
      condition: {
        field: 'operation',
        value: 'set_status',
      },
      required: false,
    },
    {
      id: 'loadingMessages',
      title: 'Loading Messages',
      type: 'long-input',
      placeholder: 'Optional JSON array of phrases to animate (max 10)',
      condition: {
        field: 'operation',
        value: 'set_status',
      },
      required: false,
    },
    // Set Assistant Title specific fields
    {
      id: 'assistantTitle',
      title: 'Thread Title',
      type: 'short-input',
      placeholder: 'Title to display for the assistant thread',
      condition: {
        field: 'operation',
        value: 'set_title',
      },
      required: true,
    },
    // Set Suggested Prompts specific fields
    {
      id: 'suggestedPrompts',
      title: 'Suggested Prompts',
      type: 'long-input',
      placeholder: '[{"title": "Summarize", "message": "Summarize this thread"}]',
      condition: {
        field: 'operation',
        value: 'set_suggested_prompts',
      },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Slack assistant suggested prompts from the user's description.
Each entry must be an object with exactly two string fields:
- "title": the short label shown on the clickable chip
- "message": the full message sent into the thread when the chip is clicked
Return at most 4 prompts.
Example:
[{"title": "Summarize", "message": "Summarize the key points of this thread"}, {"title": "Next steps", "message": "What are the next steps?"}]

Return ONLY the JSON array - no explanations, no quotes around the array, no extra text.`,
        placeholder: 'Describe the prompts you want (e.g., "summarize and list action items")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'promptsTitle',
      title: 'Prompts Heading',
      type: 'short-input',
      placeholder: 'e.g., Suggested Prompts (optional)',
      condition: {
        field: 'operation',
        value: 'set_suggested_prompts',
      },
      mode: 'advanced',
      required: false,
    },
    // Get Channel History / Get Thread Replies shared pagination fields
    {
      id: 'historyOldest',
      title: 'Oldest Timestamp',
      type: 'short-input',
      placeholder: 'Unix seconds, e.g., 1700000000 (only messages after)',
      condition: {
        field: 'operation',
        value: ['get_channel_history', 'get_thread_replies'],
      },
      required: false,
    },
    {
      id: 'historyLatest',
      title: 'Latest Timestamp',
      type: 'short-input',
      placeholder: 'Unix seconds, e.g., 1700000000 (only messages before)',
      condition: {
        field: 'operation',
        value: ['get_channel_history', 'get_thread_replies'],
      },
      required: false,
    },
    {
      id: 'historyLimit',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '200 (max 999)',
      condition: {
        field: 'operation',
        value: ['get_channel_history', 'get_thread_replies'],
      },
      required: false,
    },
    {
      id: 'historyMaxPages',
      title: 'Max Pages',
      type: 'short-input',
      placeholder: '10',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_channel_history', 'get_thread_replies'],
      },
      required: false,
    },
    {
      id: 'historyCursor',
      title: 'Start Cursor',
      type: 'short-input',
      placeholder: 'Resume from a previous nextCursor',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_channel_history', 'get_thread_replies'],
      },
      required: false,
    },
    {
      id: 'historyInclusive',
      title: 'Inclusive',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: ['get_channel_history', 'get_thread_replies'],
      },
      required: false,
    },
    {
      id: 'oldest',
      title: 'Oldest Timestamp',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: {
        field: 'operation',
        value: 'read',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
This timestamp is used to filter Slack messages - only messages after this timestamp will be returned.
Examples:
- "last hour" -> Calculate 1 hour ago from current time
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "beginning of this month" -> First day of current month at 00:00:00Z
- "30 minutes ago" -> Calculate 30 minutes before current time

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the cutoff date (e.g., "last hour", "yesterday", "last week")...',
        generationType: 'timestamp',
      },
    },
    // Download File specific fields
    {
      id: 'fileId',
      title: 'File ID',
      type: 'short-input',
      placeholder: 'Enter Slack file ID (e.g., F1234567890)',
      condition: {
        field: 'operation',
        value: 'download',
      },
      required: true,
    },
    {
      id: 'downloadFileName',
      title: 'File Name Override',
      type: 'short-input',
      canonicalParamId: 'fileName',
      placeholder: 'Optional: Override the filename',
      condition: {
        field: 'operation',
        value: 'download',
      },
    },
    // Update Message specific fields
    {
      id: 'updateTimestamp',
      title: 'Message Timestamp',
      type: 'short-input',
      placeholder: 'Message timestamp (e.g., 1405894322.002768)',
      condition: {
        field: 'operation',
        value: 'update',
      },
      required: true,
    },
    {
      id: 'updateText',
      title: 'New Message Text',
      type: 'long-input',
      placeholder: 'Enter new message text (supports Slack mrkdwn)',
      condition: {
        field: 'operation',
        value: 'update',
        and: { field: 'messageFormat', value: 'blocks', not: true },
      },
      required: {
        field: 'operation',
        value: 'update',
        and: { field: 'messageFormat', value: 'blocks', not: true },
      },
    },
    // Delete Message specific fields
    {
      id: 'deleteTimestamp',
      title: 'Message Timestamp',
      type: 'short-input',
      placeholder: 'Message timestamp (e.g., 1405894322.002768)',
      condition: {
        field: 'operation',
        value: 'delete',
      },
      required: true,
    },
    // Add Reaction specific fields
    {
      id: 'reactionTimestamp',
      title: 'Message Timestamp',
      type: 'short-input',
      placeholder: 'Message timestamp (e.g., 1405894322.002768)',
      condition: {
        field: 'operation',
        value: ['react', 'unreact'],
      },
      required: true,
    },
    {
      id: 'emojiName',
      title: 'Emoji Name',
      type: 'short-input',
      placeholder: 'Emoji name without colons (e.g., thumbsup, heart, eyes)',
      condition: {
        field: 'operation',
        value: ['react', 'unreact'],
      },
      required: true,
    },
    // Get Channel Info specific fields
    {
      id: 'includeNumMembers',
      title: 'Include Member Count',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: {
        field: 'operation',
        value: 'get_channel_info',
      },
    },
    // Get User Presence specific fields
    {
      id: 'presenceUserId',
      title: 'User',
      type: 'user-selector',
      canonicalParamId: 'presenceUserId',
      serviceId: 'slack',
      selectorKey: 'slack.users',
      placeholder: 'Select Slack user',
      mode: 'basic',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      condition: {
        field: 'operation',
        value: 'get_user_presence',
      },
      required: true,
    },
    {
      id: 'manualPresenceUserId',
      title: 'User ID',
      type: 'short-input',
      canonicalParamId: 'presenceUserId',
      placeholder: 'Enter Slack user ID (e.g., U1234567890)',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'get_user_presence',
      },
      required: true,
    },
    // Edit Canvas specific fields
    {
      id: 'editCanvasId',
      title: 'Canvas ID',
      type: 'short-input',
      placeholder: 'Enter canvas ID (e.g., F1234ABCD)',
      condition: {
        field: 'operation',
        value: 'edit_canvas',
      },
      required: true,
    },
    {
      id: 'canvasOperation',
      title: 'Edit Operation',
      type: 'dropdown',
      options: [
        { label: 'Insert at Start', id: 'insert_at_start' },
        { label: 'Insert at End', id: 'insert_at_end' },
        { label: 'Insert After Section', id: 'insert_after' },
        { label: 'Insert Before Section', id: 'insert_before' },
        { label: 'Replace Section', id: 'replace' },
        { label: 'Delete Section', id: 'delete' },
        { label: 'Rename Canvas', id: 'rename' },
      ],
      value: () => 'insert_at_end',
      condition: {
        field: 'operation',
        value: 'edit_canvas',
      },
      required: true,
    },
    {
      id: 'canvasContent',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter content in markdown format',
      condition: {
        field: 'operation',
        value: 'edit_canvas',
        and: {
          field: 'canvasOperation',
          value: ['delete', 'rename'],
          not: true,
        },
      },
    },
    {
      id: 'sectionId',
      title: 'Section ID',
      type: 'short-input',
      placeholder: 'Section ID to target',
      condition: {
        field: 'operation',
        value: 'edit_canvas',
        and: {
          field: 'canvasOperation',
          value: ['insert_after', 'insert_before', 'replace', 'delete'],
        },
      },
      required: true,
    },
    {
      id: 'canvasTitle',
      title: 'New Title',
      type: 'short-input',
      placeholder: 'Enter new canvas title',
      condition: {
        field: 'operation',
        value: 'edit_canvas',
        and: { field: 'canvasOperation', value: 'rename' },
      },
      required: true,
    },
    // Create Channel Canvas specific fields
    {
      id: 'channelCanvasTitle',
      title: 'Canvas Title',
      type: 'short-input',
      placeholder: 'Enter canvas title (optional)',
      condition: {
        field: 'operation',
        value: 'create_channel_canvas',
      },
    },
    {
      id: 'channelCanvasContent',
      title: 'Canvas Content',
      type: 'long-input',
      placeholder: 'Enter canvas content (markdown supported)',
      condition: {
        field: 'operation',
        value: 'create_channel_canvas',
      },
    },
    // Get Canvas specific fields
    {
      id: 'getCanvasId',
      title: 'Canvas ID',
      type: 'short-input',
      placeholder: 'Enter canvas ID (e.g., F1234ABCD)',
      condition: {
        field: 'operation',
        value: 'get_canvas',
      },
      required: true,
    },
    // List Canvases specific fields
    {
      id: 'canvasListCount',
      title: 'Canvas Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: 'list_canvases',
      },
      mode: 'advanced',
    },
    {
      id: 'canvasListPage',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: {
        field: 'operation',
        value: 'list_canvases',
      },
      mode: 'advanced',
    },
    {
      id: 'canvasListUser',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Optional creator filter (e.g., U1234567890)',
      condition: {
        field: 'operation',
        value: 'list_canvases',
      },
      mode: 'advanced',
    },
    {
      id: 'canvasListTsFrom',
      title: 'Created After',
      type: 'short-input',
      placeholder: 'Unix timestamp (e.g., 123456789)',
      condition: {
        field: 'operation',
        value: 'list_canvases',
      },
      mode: 'advanced',
    },
    {
      id: 'canvasListTsTo',
      title: 'Created Before',
      type: 'short-input',
      placeholder: 'Unix timestamp (e.g., 123456789)',
      condition: {
        field: 'operation',
        value: 'list_canvases',
      },
      mode: 'advanced',
    },
    {
      id: 'canvasListTeamId',
      title: 'Team ID',
      type: 'short-input',
      placeholder: 'Encoded team ID (org tokens only)',
      condition: {
        field: 'operation',
        value: 'list_canvases',
      },
      mode: 'advanced',
    },
    // Lookup Canvas Sections specific fields
    {
      id: 'lookupCanvasId',
      title: 'Canvas ID',
      type: 'short-input',
      placeholder: 'Enter canvas ID (e.g., F1234ABCD)',
      condition: {
        field: 'operation',
        value: 'lookup_canvas_sections',
      },
      required: true,
    },
    {
      id: 'sectionCriteria',
      title: 'Section Criteria',
      type: 'code',
      language: 'json',
      placeholder: '{"section_types":["h1"],"contains_text":"Roadmap"}',
      condition: {
        field: 'operation',
        value: 'lookup_canvas_sections',
      },
      required: true,
    },
    // Delete Canvas specific fields
    {
      id: 'deleteCanvasId',
      title: 'Canvas ID',
      type: 'short-input',
      placeholder: 'Enter canvas ID (e.g., F1234ABCD)',
      condition: {
        field: 'operation',
        value: 'delete_canvas',
      },
      required: true,
    },
    // Create Conversation specific fields
    {
      id: 'conversationName',
      title: 'Channel Name',
      type: 'short-input',
      placeholder: 'e.g., project-updates',
      condition: {
        field: 'operation',
        value: 'create_conversation',
      },
      required: true,
    },
    {
      id: 'isPrivate',
      title: 'Private Channel',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: 'create_conversation',
      },
    },
    {
      id: 'teamId',
      title: 'Team ID',
      type: 'short-input',
      placeholder: 'Encoded team ID (org tokens only)',
      condition: {
        field: 'operation',
        value: 'create_conversation',
      },
      mode: 'advanced',
    },
    // Invite to Conversation specific fields
    {
      id: 'inviteUsers',
      title: 'User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs (e.g., U123,U456)',
      condition: {
        field: 'operation',
        value: 'invite_to_conversation',
      },
      required: true,
    },
    {
      id: 'inviteForce',
      title: 'Skip Invalid Users',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: 'invite_to_conversation',
      },
      mode: 'advanced',
    },
    // Open View / Push View specific fields
    {
      id: 'viewTriggerId',
      title: 'Trigger ID',
      type: 'short-input',
      placeholder: 'Trigger ID from interaction payload',
      condition: {
        field: 'operation',
        value: ['open_view', 'push_view'],
      },
      required: true,
    },
    {
      id: 'viewInteractivityPointer',
      title: 'Interactivity Pointer',
      type: 'short-input',
      placeholder: 'Alternative to trigger_id (optional)',
      condition: {
        field: 'operation',
        value: ['open_view', 'push_view'],
      },
      mode: 'advanced',
    },
    // Update View specific fields
    {
      id: 'viewId',
      title: 'View ID',
      type: 'short-input',
      placeholder: 'Unique view identifier (either View ID or External ID required)',
      condition: {
        field: 'operation',
        value: 'update_view',
      },
    },
    {
      id: 'viewExternalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'Developer-set unique identifier (max 255 chars)',
      condition: {
        field: 'operation',
        value: 'update_view',
      },
    },
    // Update View / Publish View hash field
    {
      id: 'viewHash',
      title: 'View Hash',
      type: 'short-input',
      placeholder: 'View state hash for race condition protection',
      condition: {
        field: 'operation',
        value: ['update_view', 'publish_view'],
      },
      mode: 'advanced',
    },
    // Publish View specific fields
    {
      id: 'publishUserId',
      title: 'User',
      type: 'user-selector',
      canonicalParamId: 'publishUserId',
      serviceId: 'slack',
      selectorKey: 'slack.users',
      placeholder: 'Select user to publish Home tab to',
      mode: 'basic',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      condition: {
        field: 'operation',
        value: 'publish_view',
      },
      required: true,
    },
    {
      id: 'manualPublishUserId',
      title: 'User ID',
      type: 'short-input',
      canonicalParamId: 'publishUserId',
      placeholder: 'Enter Slack user ID (e.g., U0BPQUNTA)',
      dependsOn: { all: ['authMethod'], any: ['credential', 'botToken', 'customBotCredential'] },
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'publish_view',
      },
      required: true,
    },
    // View payload (shared across all view operations)
    {
      id: 'viewPayload',
      title: 'View Payload',
      type: 'code',
      language: 'json',
      placeholder: 'JSON view payload with type, title, and blocks',
      condition: {
        field: 'operation',
        value: ['open_view', 'update_view', 'push_view', 'publish_view'],
      },
      required: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert at Slack Block Kit views.
Generate ONLY a valid JSON view payload object based on the user's request.
The output MUST be a JSON object starting with { and ending with }.

Current view: {context}

The view object must include:
- "type": "modal" (for open/update/push) or "home" (for publish)
- "title": { "type": "plain_text", "text": "Title text", "emoji": true } (max 24 chars)
- "blocks": Array of Block Kit blocks

Optional fields:
- "submit": { "type": "plain_text", "text": "Submit" } - Submit button text
- "close": { "type": "plain_text", "text": "Cancel" } - Close button text
- "private_metadata": String up to 3000 chars
- "callback_id": String identifier for interaction handling
- "clear_on_close": true/false
- "notify_on_close": true/false
- "external_id": Unique string per workspace (max 255 chars)

Available block types:
- "section": Text with optional accessory. Text uses { "type": "mrkdwn", "text": "..." } or { "type": "plain_text", "text": "..." }
- "input": Form input with a label and element (plain_text_input, static_select, multi_static_select, datepicker, timepicker, checkboxes, radio_buttons)
- "header": Large text header (plain_text only)
- "divider": Horizontal rule separator
- "image": Requires "image_url" and "alt_text"
- "context": Contextual info with "elements" array
- "actions": Interactive elements like buttons

Example modal:
{
  "type": "modal",
  "title": { "type": "plain_text", "text": "My Form" },
  "submit": { "type": "plain_text", "text": "Submit" },
  "close": { "type": "plain_text", "text": "Cancel" },
  "blocks": [
    {
      "type": "input",
      "block_id": "input_1",
      "label": { "type": "plain_text", "text": "Name" },
      "element": { "type": "plain_text_input", "action_id": "name_input" }
    }
  ]
}

You can reference workflow variables using angle brackets, e.g., <blockName.output>.
Do not include any explanations, markdown formatting, or other text outside the JSON object.`,
        placeholder: 'Describe the view/modal you want to create...',
      },
    },
    // Schedule Message specific fields
    {
      id: 'scheduleAt',
      title: 'Send At',
      type: 'short-input',
      placeholder: 'Unix timestamp in seconds (e.g., 1700000000)',
      condition: {
        field: 'operation',
        value: 'schedule_message',
      },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
The timestamp must represent a time in the future (Slack rejects past times and times more than 120 days out).
Examples:
- "in 1 hour" -> current Unix time + 3600
- "tomorrow at 9am" -> Unix timestamp for tomorrow 09:00 local time
- "next Monday" -> Unix timestamp for the next Monday at 00:00

If the input looks like a reference to another block's output (contains < and >) or is already a numeric Unix timestamp, return it as-is.
Return ONLY the integer Unix timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe when to send (e.g., "in 2 hours", "tomorrow at 9am")...',
        generationType: 'timestamp',
      },
    },
    // List Scheduled Messages specific fields
    {
      id: 'scheduledLimit',
      title: 'Message Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: 'list_scheduled_messages',
      },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'scheduledCursor',
      title: 'Pagination Cursor',
      type: 'short-input',
      placeholder: 'next_cursor from a previous response',
      condition: {
        field: 'operation',
        value: 'list_scheduled_messages',
      },
      mode: 'advanced',
      required: false,
    },
    // Delete Scheduled Message specific fields
    {
      id: 'scheduledMessageId',
      title: 'Scheduled Message ID',
      type: 'short-input',
      placeholder: 'Scheduled message ID (e.g., Q1234ABCD)',
      condition: {
        field: 'operation',
        value: 'delete_scheduled_message',
      },
      required: true,
    },
    // Rename Conversation specific fields
    {
      id: 'renameChannelName',
      title: 'New Channel Name',
      type: 'short-input',
      placeholder: 'e.g., project-updates (max 80 chars)',
      condition: {
        field: 'operation',
        value: 'rename_conversation',
      },
      required: true,
    },
    // Set Conversation Topic specific fields
    {
      id: 'conversationTopic',
      title: 'Topic',
      type: 'long-input',
      placeholder: 'New channel topic (max 250 characters)',
      condition: {
        field: 'operation',
        value: 'set_conversation_topic',
      },
      required: true,
    },
    // Set Conversation Purpose specific fields
    {
      id: 'conversationPurpose',
      title: 'Purpose',
      type: 'long-input',
      placeholder: 'New channel purpose/description (max 250 characters)',
      condition: {
        field: 'operation',
        value: 'set_conversation_purpose',
      },
      required: true,
    },
    ...getTrigger('slack_webhook').subBlocks,
  ],
  tools: {
    access: [
      'slack_message',
      'slack_ephemeral_message',
      'slack_canvas',
      'slack_message_reader',
      'slack_get_message',
      'slack_get_thread',
      'slack_get_thread_replies',
      'slack_get_channel_history',
      'slack_get_permalink',
      'slack_set_status',
      'slack_set_title',
      'slack_set_suggested_prompts',
      'slack_list_channels',
      'slack_list_members',
      'slack_list_users',
      'slack_get_user',
      'slack_download',
      'slack_update_message',
      'slack_delete_message',
      'slack_add_reaction',
      'slack_remove_reaction',
      'slack_get_channel_info',
      'slack_get_user_presence',
      'slack_edit_canvas',
      'slack_create_channel_canvas',
      'slack_get_canvas',
      'slack_list_canvases',
      'slack_lookup_canvas_sections',
      'slack_delete_canvas',
      'slack_create_conversation',
      'slack_invite_to_conversation',
      'slack_open_view',
      'slack_update_view',
      'slack_push_view',
      'slack_publish_view',
      'slack_schedule_message',
      'slack_list_scheduled_messages',
      'slack_delete_scheduled_message',
      'slack_archive_conversation',
      'slack_rename_conversation',
      'slack_set_conversation_topic',
      'slack_set_conversation_purpose',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send':
            return 'slack_message'
          case 'ephemeral':
            return 'slack_ephemeral_message'
          case 'canvas':
            return 'slack_canvas'
          case 'read':
            return 'slack_message_reader'
          case 'get_message':
            return 'slack_get_message'
          case 'get_thread':
            return 'slack_get_thread'
          case 'get_thread_replies':
            return 'slack_get_thread_replies'
          case 'get_channel_history':
            return 'slack_get_channel_history'
          case 'get_permalink':
            return 'slack_get_permalink'
          case 'set_status':
            return 'slack_set_status'
          case 'set_title':
            return 'slack_set_title'
          case 'set_suggested_prompts':
            return 'slack_set_suggested_prompts'
          case 'list_channels':
            return 'slack_list_channels'
          case 'list_members':
            return 'slack_list_members'
          case 'list_users':
            return 'slack_list_users'
          case 'get_user':
            return 'slack_get_user'
          case 'download':
            return 'slack_download'
          case 'update':
            return 'slack_update_message'
          case 'delete':
            return 'slack_delete_message'
          case 'react':
            return 'slack_add_reaction'
          case 'unreact':
            return 'slack_remove_reaction'
          case 'get_channel_info':
            return 'slack_get_channel_info'
          case 'get_user_presence':
            return 'slack_get_user_presence'
          case 'edit_canvas':
            return 'slack_edit_canvas'
          case 'create_channel_canvas':
            return 'slack_create_channel_canvas'
          case 'get_canvas':
            return 'slack_get_canvas'
          case 'list_canvases':
            return 'slack_list_canvases'
          case 'lookup_canvas_sections':
            return 'slack_lookup_canvas_sections'
          case 'delete_canvas':
            return 'slack_delete_canvas'
          case 'create_conversation':
            return 'slack_create_conversation'
          case 'invite_to_conversation':
            return 'slack_invite_to_conversation'
          case 'open_view':
            return 'slack_open_view'
          case 'update_view':
            return 'slack_update_view'
          case 'push_view':
            return 'slack_push_view'
          case 'publish_view':
            return 'slack_publish_view'
          case 'schedule_message':
            return 'slack_schedule_message'
          case 'list_scheduled_messages':
            return 'slack_list_scheduled_messages'
          case 'delete_scheduled_message':
            return 'slack_delete_scheduled_message'
          case 'archive_conversation':
            return 'slack_archive_conversation'
          case 'rename_conversation':
            return 'slack_rename_conversation'
          case 'set_conversation_topic':
            return 'slack_set_conversation_topic'
          case 'set_conversation_purpose':
            return 'slack_set_conversation_purpose'
          default:
            throw new Error(`Invalid Slack operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          authMethod,
          botToken,
          botCredential,
          operation,
          destinationType,
          channel,
          dmUserId,
          messageFormat,
          text,
          title,
          content,
          limit,
          oldest,
          files,
          blocks,
          threadTs,
          ephemeralUser,
          updateTimestamp,
          updateText,
          deleteTimestamp,
          reactionTimestamp,
          emojiName,
          includePrivate,
          channelLimit,
          memberLimit,
          includeDeleted,
          userLimit,
          userId,
          getMessageTimestamp,
          getThreadTimestamp,
          threadLimit,
          status,
          loadingMessages,
          assistantTitle,
          suggestedPrompts,
          promptsTitle,
          historyOldest,
          historyLatest,
          historyLimit,
          historyMaxPages,
          historyCursor,
          historyInclusive,
          includeNumMembers,
          presenceUserId,
          editCanvasId,
          canvasOperation,
          canvasContent,
          sectionId,
          canvasTitle,
          channelCanvasTitle,
          channelCanvasContent,
          getCanvasId,
          canvasListCount,
          canvasListPage,
          canvasListUser,
          canvasListTsFrom,
          canvasListTsTo,
          canvasListTeamId,
          lookupCanvasId,
          sectionCriteria,
          deleteCanvasId,
          conversationName,
          isPrivate,
          teamId,
          inviteUsers,
          inviteForce,
          viewTriggerId,
          viewInteractivityPointer,
          viewId,
          viewExternalId,
          viewHash,
          publishUserId,
          viewPayload,
          fileId,
          fileName,
          paginationCursor,
          scheduleAt,
          scheduledLimit,
          scheduledCursor,
          scheduledMessageId,
          renameChannelName,
          conversationTopic,
          conversationPurpose,
          ...rest
        } = params

        const isDM = destinationType === 'dm'
        const effectiveChannel = channel ? String(channel).trim() : ''
        const effectiveUserId = dmUserId ? String(dmUserId).trim() : ''

        const dmSupportedOperations = ['send', 'read']

        const baseParams: Record<string, any> = {}

        if (isDM && dmSupportedOperations.includes(operation)) {
          baseParams.userId = effectiveUserId
        } else if (isDM && operation === 'schedule_message' && effectiveUserId) {
          // chat.scheduleMessage opens a DM when the channel is set to a user ID
          baseParams.channel = effectiveUserId
        } else if (effectiveChannel) {
          baseParams.channel = effectiveChannel
        }

        // Handle authentication based on method. Custom Bot resolves to a token
        // server-side: v2 selects a reusable bot credential; v1 pastes a raw
        // token (kept for back-compat).
        if (authMethod === 'bot_token') {
          if (botCredential) {
            baseParams.credential = botCredential
          } else if (botToken) {
            baseParams.accessToken = botToken
          }
        } else {
          // Default to OAuth
          baseParams.credential = oauthCredential
        }

        switch (operation) {
          case 'send': {
            baseParams.text = messageFormat === 'blocks' && !text ? ' ' : text
            if (threadTs) {
              baseParams.threadTs = threadTs
            }
            if (blocks) {
              baseParams.blocks = blocks
            }
            // files is the canonical param from attachmentFiles (basic) or files (advanced)
            const normalizedFiles = normalizeFileInput(files)
            if (normalizedFiles) {
              baseParams.files = normalizedFiles
            }
            break
          }

          case 'ephemeral': {
            baseParams.text = messageFormat === 'blocks' && !text ? ' ' : text
            baseParams.user = ephemeralUser ? String(ephemeralUser).trim() : ''
            if (threadTs) {
              baseParams.threadTs = threadTs
            }
            if (blocks) {
              baseParams.blocks = blocks
            }
            break
          }

          case 'canvas':
            baseParams.title = title
            baseParams.content = content
            break

          case 'read': {
            const parsedLimit = limit ? Number.parseInt(limit, 10) : 10
            if (Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 15) {
              throw new Error('Message limit must be between 1 and 15')
            }
            baseParams.limit = parsedLimit
            if (oldest) {
              baseParams.oldest = oldest
            }
            break
          }

          case 'get_message':
            baseParams.timestamp = getMessageTimestamp
            break

          case 'get_thread': {
            baseParams.threadTs = getThreadTimestamp
            if (threadLimit) {
              const parsedLimit = Number.parseInt(threadLimit, 10)
              if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
                baseParams.limit = Math.min(parsedLimit, 200)
              }
            }
            break
          }

          case 'set_status': {
            baseParams.threadTs = getThreadTimestamp
            baseParams.status = status ?? ''
            if (loadingMessages) {
              baseParams.loadingMessages = loadingMessages
            }
            break
          }

          case 'set_title': {
            baseParams.threadTs = getThreadTimestamp
            baseParams.title = assistantTitle
            break
          }

          case 'set_suggested_prompts': {
            baseParams.threadTs = getThreadTimestamp
            baseParams.prompts = suggestedPrompts
            if (promptsTitle) {
              baseParams.promptsTitle = promptsTitle
            }
            break
          }

          case 'get_permalink': {
            baseParams.messageTs = getMessageTimestamp
            break
          }

          case 'get_channel_history':
          case 'get_thread_replies': {
            if (operation === 'get_thread_replies') {
              baseParams.threadTs = getThreadTimestamp
            }
            if (historyOldest) {
              baseParams.oldest = String(historyOldest).trim()
            }
            if (historyLatest) {
              baseParams.latest = String(historyLatest).trim()
            }
            if (historyLimit) {
              const parsedLimit = Number.parseInt(historyLimit, 10)
              if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
                baseParams.limit = parsedLimit
              }
            }
            if (historyMaxPages) {
              const parsedMaxPages = Number.parseInt(historyMaxPages, 10)
              if (!Number.isNaN(parsedMaxPages) && parsedMaxPages > 0) {
                baseParams.maxPages = parsedMaxPages
              }
            }
            if (historyCursor) {
              baseParams.cursor = String(historyCursor).trim()
            }
            baseParams.inclusive = historyInclusive === 'true'
            break
          }

          case 'list_channels': {
            baseParams.includePrivate = includePrivate !== 'false'
            baseParams.excludeArchived = true
            baseParams.limit = channelLimit ? Number.parseInt(channelLimit, 10) : 100
            if (paginationCursor) {
              baseParams.cursor = String(paginationCursor).trim()
            }
            break
          }

          case 'list_members': {
            baseParams.limit = memberLimit ? Number.parseInt(memberLimit, 10) : 100
            if (paginationCursor) {
              baseParams.cursor = String(paginationCursor).trim()
            }
            break
          }

          case 'list_users': {
            baseParams.includeDeleted = includeDeleted === 'true'
            baseParams.limit = userLimit ? Number.parseInt(userLimit, 10) : 100
            if (paginationCursor) {
              baseParams.cursor = String(paginationCursor).trim()
            }
            break
          }

          case 'get_user':
            baseParams.userId = userId
            break

          case 'download': {
            baseParams.fileId = fileId
            if (fileName) {
              baseParams.fileName = fileName
            }
            break
          }

          case 'update':
            baseParams.timestamp = updateTimestamp
            baseParams.text = messageFormat === 'blocks' && !updateText ? ' ' : updateText
            if (blocks) {
              baseParams.blocks = blocks
            }
            break

          case 'delete':
            baseParams.timestamp = deleteTimestamp
            break

          case 'react':
          case 'unreact':
            baseParams.timestamp = reactionTimestamp
            baseParams.name = emojiName
            break

          case 'get_channel_info':
            baseParams.includeNumMembers = includeNumMembers !== 'false'
            break

          case 'get_user_presence':
            baseParams.userId = presenceUserId
            break

          case 'edit_canvas':
            baseParams.canvasId = editCanvasId
            baseParams.operation = canvasOperation
            if (canvasContent) {
              baseParams.content = canvasContent
            }
            if (sectionId) {
              baseParams.sectionId = sectionId
            }
            if (canvasTitle) {
              baseParams.title = canvasTitle
            }
            break

          case 'create_channel_canvas':
            if (channelCanvasTitle) {
              baseParams.title = channelCanvasTitle
            }
            if (channelCanvasContent) {
              baseParams.content = channelCanvasContent
            }
            break

          case 'get_canvas':
            baseParams.canvasId = getCanvasId
            break

          case 'list_canvases':
            if (canvasListCount) {
              const parsedCount = Number.parseInt(canvasListCount, 10)
              if (!Number.isNaN(parsedCount) && parsedCount > 0) {
                baseParams.count = parsedCount
              }
            }
            if (canvasListPage) {
              const parsedPage = Number.parseInt(canvasListPage, 10)
              if (!Number.isNaN(parsedPage) && parsedPage > 0) {
                baseParams.page = parsedPage
              }
            }
            if (canvasListUser) {
              baseParams.user = String(canvasListUser).trim()
            }
            if (canvasListTsFrom) {
              baseParams.tsFrom = String(canvasListTsFrom).trim()
            }
            if (canvasListTsTo) {
              baseParams.tsTo = String(canvasListTsTo).trim()
            }
            if (canvasListTeamId) {
              baseParams.teamId = String(canvasListTeamId).trim()
            }
            break

          case 'lookup_canvas_sections':
            baseParams.canvasId = lookupCanvasId
            baseParams.criteria = sectionCriteria
            break

          case 'delete_canvas':
            baseParams.canvasId = deleteCanvasId
            break

          case 'create_conversation':
            baseParams.name = conversationName
            baseParams.isPrivate = isPrivate === 'true'
            if (teamId) {
              baseParams.teamId = teamId
            }
            break

          case 'invite_to_conversation':
            baseParams.users = inviteUsers
            if (inviteForce === 'true') {
              baseParams.force = true
            }
            break

          case 'open_view':
            baseParams.triggerId = viewTriggerId
            if (viewInteractivityPointer) {
              baseParams.interactivityPointer = viewInteractivityPointer
            }
            baseParams.view = viewPayload
            break

          case 'update_view': {
            const trimmedViewId = viewId ? String(viewId).trim() : ''
            const trimmedExternalId = viewExternalId ? String(viewExternalId).trim() : ''
            if (!trimmedViewId && !trimmedExternalId) {
              throw new Error('update_view requires either View ID or External ID')
            }
            if (trimmedViewId) {
              baseParams.viewId = trimmedViewId
            }
            if (trimmedExternalId) {
              baseParams.externalId = trimmedExternalId
            }
            if (viewHash) {
              baseParams.hash = viewHash
            }
            baseParams.view = viewPayload
            break
          }

          case 'push_view':
            baseParams.triggerId = viewTriggerId
            if (viewInteractivityPointer) {
              baseParams.interactivityPointer = viewInteractivityPointer
            }
            baseParams.view = viewPayload
            break

          case 'publish_view':
            baseParams.userId = publishUserId
            if (viewHash) {
              baseParams.hash = viewHash
            }
            baseParams.view = viewPayload
            break

          case 'schedule_message': {
            baseParams.text = messageFormat === 'blocks' && !text ? ' ' : text
            if (blocks) {
              baseParams.blocks = blocks
            }
            if (threadTs) {
              baseParams.threadTs = threadTs
            }
            const parsedPostAt = Number.parseInt(String(scheduleAt ?? '').trim(), 10)
            if (Number.isNaN(parsedPostAt)) {
              throw new Error('Send At must be a Unix timestamp in seconds')
            }
            baseParams.postAt = parsedPostAt
            break
          }

          case 'list_scheduled_messages': {
            if (scheduledLimit) {
              const parsedLimit = Number.parseInt(scheduledLimit, 10)
              if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
                baseParams.limit = parsedLimit
              }
            }
            if (scheduledCursor) {
              baseParams.cursor = String(scheduledCursor).trim()
            }
            break
          }

          case 'delete_scheduled_message':
            baseParams.scheduledMessageId = scheduledMessageId
            break

          case 'archive_conversation':
            break

          case 'rename_conversation':
            baseParams.name = renameChannelName
            break

          case 'set_conversation_topic':
            baseParams.topic = conversationTopic
            break

          case 'set_conversation_purpose':
            baseParams.purpose = conversationPurpose
            break
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    messageFormat: { type: 'string', description: 'Message format: text or blocks' },
    authMethod: { type: 'string', description: 'Authentication method' },
    destinationType: { type: 'string', description: 'Destination type (channel or dm)' },
    oauthCredential: { type: 'string', description: 'Slack access token' },
    botToken: { type: 'string', description: 'Bot token' },
    botCredential: { type: 'string', description: 'Custom Slack bot credential id' },
    channel: { type: 'string', description: 'Channel identifier (canonical param)' },
    dmUserId: { type: 'string', description: 'User ID for DM recipient (canonical param)' },
    text: { type: 'string', description: 'Message text' },
    files: { type: 'array', description: 'Files to attach (canonical param)' },
    title: { type: 'string', description: 'Canvas title' },
    content: { type: 'string', description: 'Canvas content' },
    limit: { type: 'string', description: 'Message limit' },
    oldest: { type: 'string', description: 'Oldest timestamp' },
    fileId: { type: 'string', description: 'File ID to download' },
    fileName: { type: 'string', description: 'File name override for download (canonical param)' },
    // Update/Delete/React operation inputs
    updateTimestamp: { type: 'string', description: 'Message timestamp for update' },
    updateText: { type: 'string', description: 'New text for update' },
    deleteTimestamp: { type: 'string', description: 'Message timestamp for delete' },
    reactionTimestamp: { type: 'string', description: 'Message timestamp for reaction' },
    emojiName: { type: 'string', description: 'Emoji name for reaction' },
    timestamp: { type: 'string', description: 'Message timestamp' },
    name: { type: 'string', description: 'Emoji name' },
    threadTs: { type: 'string', description: 'Thread timestamp' },
    thread_ts: { type: 'string', description: 'Thread timestamp for reply' },
    // List Channels inputs
    includePrivate: { type: 'string', description: 'Include private channels (true/false)' },
    channelLimit: { type: 'string', description: 'Maximum number of channels to return' },
    // List Members inputs
    memberLimit: { type: 'string', description: 'Maximum number of members to return' },
    // List Users inputs
    includeDeleted: { type: 'string', description: 'Include deactivated users (true/false)' },
    userLimit: { type: 'string', description: 'Maximum number of users to return' },
    // Shared pagination input
    paginationCursor: {
      type: 'string',
      description: 'Pagination cursor (next_cursor) for list_channels/list_members/list_users',
    },
    // Ephemeral message inputs
    ephemeralUser: { type: 'string', description: 'User ID who will see the ephemeral message' },
    blocks: { type: 'json', description: 'Block Kit layout blocks as a JSON array' },
    // Get User inputs
    userId: { type: 'string', description: 'User ID to look up' },
    // Get Message inputs
    getMessageTimestamp: { type: 'string', description: 'Message timestamp to retrieve' },
    // Get Thread inputs
    getThreadTimestamp: { type: 'string', description: 'Thread timestamp to retrieve' },
    threadLimit: {
      type: 'string',
      description: 'Maximum number of messages to return from thread',
    },
    // Set Assistant Status inputs
    status: { type: 'string', description: 'Status text to display (empty clears the status)' },
    loadingMessages: {
      type: 'json',
      description: 'Optional array of phrases to animate as a loading indicator (max 10)',
    },
    // Set Assistant Title inputs
    assistantTitle: { type: 'string', description: 'Title to display for the assistant thread' },
    // Set Suggested Prompts inputs
    suggestedPrompts: {
      type: 'json',
      description: 'Array of { title, message } prompt objects (max 4)',
    },
    promptsTitle: { type: 'string', description: 'Optional heading for the prompt list' },
    // Get Channel History / Get Thread Replies inputs
    historyOldest: {
      type: 'string',
      description: 'Only include messages after this Unix timestamp',
    },
    historyLatest: {
      type: 'string',
      description: 'Only include messages before this Unix timestamp',
    },
    historyLimit: { type: 'string', description: 'Messages to request per page (max 999)' },
    historyMaxPages: { type: 'string', description: 'Maximum number of pages to fetch' },
    historyCursor: { type: 'string', description: 'Pagination cursor to resume from' },
    historyInclusive: {
      type: 'string',
      description: 'Include messages matching oldest/latest (true/false)',
    },
    // Get Channel Info inputs
    includeNumMembers: { type: 'string', description: 'Include member count (true/false)' },
    // Get User Presence inputs
    presenceUserId: { type: 'string', description: 'User ID to check presence for' },
    // Edit Canvas inputs
    editCanvasId: { type: 'string', description: 'Canvas ID to edit' },
    canvasOperation: { type: 'string', description: 'Canvas edit operation' },
    canvasContent: { type: 'string', description: 'Markdown content for canvas edit' },
    sectionId: { type: 'string', description: 'Canvas section ID to target' },
    canvasTitle: { type: 'string', description: 'New canvas title for rename' },
    // Create Channel Canvas inputs
    channelCanvasTitle: { type: 'string', description: 'Title for channel canvas' },
    channelCanvasContent: { type: 'string', description: 'Content for channel canvas' },
    // Canvas management inputs
    getCanvasId: { type: 'string', description: 'Canvas ID to retrieve' },
    canvasListCount: { type: 'string', description: 'Maximum number of canvases to return' },
    canvasListPage: { type: 'string', description: 'Canvas list page number' },
    canvasListUser: { type: 'string', description: 'Optional canvas creator user filter' },
    canvasListTsFrom: {
      type: 'string',
      description: 'Filter canvases created after this timestamp',
    },
    canvasListTsTo: {
      type: 'string',
      description: 'Filter canvases created before this timestamp',
    },
    canvasListTeamId: { type: 'string', description: 'Encoded team ID for org tokens' },
    lookupCanvasId: { type: 'string', description: 'Canvas ID to search for sections' },
    sectionCriteria: { type: 'json', description: 'Canvas section lookup criteria' },
    deleteCanvasId: { type: 'string', description: 'Canvas ID to delete' },
    // Create Conversation inputs
    conversationName: { type: 'string', description: 'Name for the new channel' },
    isPrivate: { type: 'string', description: 'Create as private channel (true/false)' },
    teamId: { type: 'string', description: 'Encoded team ID for org tokens' },
    // Invite to Conversation inputs
    inviteUsers: { type: 'string', description: 'Comma-separated user IDs to invite' },
    inviteForce: { type: 'string', description: 'Skip invalid users (true/false)' },
    // View operation inputs
    viewTriggerId: { type: 'string', description: 'Trigger ID from interaction payload' },
    viewInteractivityPointer: {
      type: 'string',
      description: 'Alternative to trigger_id for posting to user',
    },
    viewId: { type: 'string', description: 'Unique view identifier for update' },
    viewExternalId: {
      type: 'string',
      description: 'Developer-set unique identifier for update (max 255 chars)',
    },
    viewHash: { type: 'string', description: 'View state hash for race condition protection' },
    publishUserId: {
      type: 'string',
      description: 'User ID to publish Home tab view to',
    },
    viewPayload: { type: 'json', description: 'View payload object with type, title, and blocks' },
    // Schedule Message inputs
    scheduleAt: {
      type: 'string',
      description: 'Unix timestamp (seconds) for when the scheduled message should post',
    },
    // List Scheduled Messages inputs
    scheduledLimit: {
      type: 'string',
      description: 'Maximum number of scheduled messages to return',
    },
    scheduledCursor: { type: 'string', description: 'Pagination cursor for scheduled messages' },
    // Delete Scheduled Message inputs
    scheduledMessageId: { type: 'string', description: 'Scheduled message ID to delete' },
    // Rename Conversation inputs
    renameChannelName: { type: 'string', description: 'New name for the channel' },
    // Set Conversation Topic inputs
    conversationTopic: { type: 'string', description: 'New channel topic (max 250 characters)' },
    // Set Conversation Purpose inputs
    conversationPurpose: {
      type: 'string',
      description: 'New channel purpose/description (max 250 characters)',
    },
  },
  outputs: {
    // slack_message outputs (send operation)
    message: {
      type: 'json',
      description:
        'Complete message object with all properties: ts, text, user, channel, reactions, threads, files, attachments, blocks, stars, pins, and edit history',
    },
    // Legacy properties for send operation (backward compatibility)
    ts: { type: 'string', description: 'Message timestamp returned by Slack API' },
    channel: { type: 'string', description: 'Channel identifier where message was sent' },
    fileCount: {
      type: 'number',
      description: 'Number of files uploaded (when files are attached)',
    },
    files: { type: 'file[]', description: 'Files attached to the message' },

    // slack_ephemeral_message outputs (ephemeral operation)
    messageTs: {
      type: 'string',
      description: 'Timestamp of the ephemeral message (cannot be used to update or delete)',
    },

    // slack_canvas outputs
    canvas_id: { type: 'string', description: 'Canvas identifier for created canvases' },
    title: { type: 'string', description: 'Canvas title' },
    canvas: {
      type: 'json',
      description: 'Canvas file metadata returned by Slack',
    },
    canvases: {
      type: 'json',
      description: 'Array of canvas file objects returned by Slack',
    },
    paging: {
      type: 'json',
      description: 'Pagination information for listed canvases',
    },
    sections: {
      type: 'json',
      description: 'Canvas section IDs returned by Slack section lookup',
    },
    ok: {
      type: 'boolean',
      description: 'Whether Slack completed the canvas operation successfully',
    },

    // slack_message_reader outputs (read operation)
    messages: {
      type: 'json',
      description:
        'Array of message objects with comprehensive properties: text, user, timestamp, reactions, threads, files, attachments, blocks, stars, pins, and edit history',
    },

    // slack_get_thread outputs (get_thread operation)
    parentMessage: {
      type: 'json',
      description: 'The thread parent message with all properties',
    },
    replies: {
      type: 'json',
      description: 'Array of reply messages in the thread (excluding the parent)',
    },
    replyCount: {
      type: 'number',
      description: 'Number of replies returned in this response',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether there are more messages in the thread',
    },

    // slack_get_channel_history / slack_get_thread_replies pagination outputs
    pages: {
      type: 'number',
      description: 'Number of pages fetched during a paginated history/replies read',
    },
    threadTs: {
      type: 'string',
      description: 'Thread timestamp an assistant status/title/prompts op was set on',
    },

    // slack_get_permalink outputs (get_permalink operation)
    permalink: {
      type: 'string',
      description: 'Permalink URL to the message',
    },

    // slack_list_channels outputs (list_channels operation)
    channels: {
      type: 'json',
      description:
        'Array of channel objects with properties: id, name, is_private, is_archived, is_member, num_members, topic, purpose, created, creator',
    },
    count: {
      type: 'number',
      description: 'Total number of items returned (channels, members, or users)',
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page (null when there are no more pages)',
    },

    // slack_list_members outputs (list_members operation)
    members: {
      type: 'json',
      description: 'Array of user IDs who are members of the channel',
    },

    // slack_list_users outputs (list_users operation)
    users: {
      type: 'json',
      description:
        'Array of user objects with properties: id, name, real_name, display_name, is_bot, is_admin, deleted, timezone, avatar, status_text, status_emoji',
    },

    // slack_get_user outputs (get_user operation)
    user: {
      type: 'json',
      description:
        'Detailed user object with properties: id, name, real_name, display_name, first_name, last_name, title, is_bot, is_admin, deleted, timezone, avatars, status',
    },

    // slack_download outputs
    file: {
      type: 'file',
      description: 'Downloaded file stored in execution files',
    },

    // slack_update_message outputs (update operation)
    content: { type: 'string', description: 'Success message for update operation' },
    metadata: {
      type: 'json',
      description: 'Updated message metadata (legacy, use message object instead)',
    },

    // slack_get_channel_info outputs (get_channel_info operation)
    channelInfo: {
      type: 'json',
      description:
        'Detailed channel object with properties: id, name, is_private, is_archived, is_member, num_members, topic, purpose, created, creator',
    },

    // slack_get_user_presence outputs (get_user_presence operation)
    presence: {
      type: 'string',
      description: 'User presence status: "active" or "away"',
    },
    online: {
      type: 'boolean',
      description:
        'Whether user has an active client connection (only available when checking own presence)',
    },
    autoAway: {
      type: 'boolean',
      description:
        'Whether user was automatically set to away (only available when checking own presence)',
    },
    manualAway: {
      type: 'boolean',
      description:
        'Whether user manually set themselves as away (only available when checking own presence)',
    },
    connectionCount: {
      type: 'number',
      description: 'Total number of active connections (only available when checking own presence)',
    },
    lastActivity: {
      type: 'number',
      description:
        'Unix timestamp of last detected activity (only available when checking own presence)',
    },

    // View operation outputs (open_view, update_view, push_view, publish_view)
    view: {
      type: 'json',
      description:
        'View object with properties: id, team_id, type, title, submit, close, blocks, private_metadata, callback_id, external_id, state, hash, clear_on_close, notify_on_close, root_view_id, previous_view_id, app_id, bot_id',
    },

    // slack_invite_to_conversation outputs (invite_to_conversation operation)
    errors: {
      type: 'json',
      description:
        'Array of per-user error objects when force is true and some invitations failed (user, ok, error)',
    },

    // slack_schedule_message outputs (schedule_message operation)
    scheduledMessageId: {
      type: 'string',
      description: 'Identifier of the scheduled message (used to delete it before it posts)',
    },
    postAt: {
      type: 'number',
      description: 'Unix timestamp when a scheduled message will post',
    },

    // slack_list_scheduled_messages outputs (list_scheduled_messages operation)
    scheduledMessages: {
      type: 'json',
      description:
        'Array of pending scheduled message objects with properties: id, channel_id, post_at, date_created, text',
    },

    // slack_set_conversation_purpose outputs (set_conversation_purpose operation)
    purpose: {
      type: 'string',
      description: 'The purpose/description that was set on the channel',
    },

    // Trigger outputs (when used as webhook trigger)
    event_type: { type: 'string', description: 'Type of Slack event that triggered the workflow' },
    subtype: {
      type: 'string',
      description:
        'Message subtype (e.g., channel_join, channel_leave, bot_message). Null for regular user messages',
    },
    channel_name: { type: 'string', description: 'Human-readable channel name' },
    channel_type: {
      type: 'string',
      description: 'Type of channel (e.g., channel, group, im, mpim)',
    },
    user_name: { type: 'string', description: 'Username who triggered the event' },
    bot_id: {
      type: 'string',
      description: 'Bot ID if the message was sent by a bot. Null for human users',
    },
    timestamp: { type: 'string', description: 'Message timestamp from the triggering event' },
    thread_ts: {
      type: 'string',
      description: 'Parent thread timestamp (if message is in a thread)',
    },
    team_id: { type: 'string', description: 'Slack workspace/team ID' },
    event_id: { type: 'string', description: 'Unique event identifier for the trigger' },
  },
  // Trigger capabilities moved to slack_v2 so the trigger surfaces once.
  // Legacy webhook trigger stays available while slack_v2 (which hosts the
  // redesigned slack_oauth trigger) is preview-gated; drops at v2 GA.
  triggers: {
    enabled: true,
    available: ['slack_webhook'],
  },
}

export const SlackBlockMeta = {
  tags: ['messaging', 'webhooks', 'automation'],
  url: 'https://slack.com',
  templates: [
    {
      icon: SlackIcon,
      title: 'Slack Q&A bot',
      prompt:
        'Create a knowledge base connected to my Notion workspace so it stays synced with my company wiki. Then build a workflow that monitors Slack channels for questions and answers them using the knowledge base with source citations.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'team'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: Table,
      title: 'Slack churn risk alerts',
      prompt:
        'Create a workflow that monitors customer activity — support ticket frequency, response sentiment, usage patterns — scores each account for churn risk in a table, and triggers a Slack alert to the account team when a customer crosses the risk threshold.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'sales', 'monitoring', 'analysis'],
    },
    {
      icon: SlackIcon,
      title: 'Slack incident postmortem writer',
      prompt:
        'Create a workflow that when triggered after an incident, pulls the Slack thread from the incident channel, gathers relevant Sentry errors and deployment logs, and drafts a structured postmortem with timeline, root cause, and action items.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'analysis'],
      alsoIntegrations: ['sentry'],
    },
    {
      icon: GreptileIcon,
      title: 'Slack code Q&A bot',
      prompt:
        'Build a workflow that monitors a Slack channel for code questions, routes them to Greptile against the relevant repository, and replies in-thread with the answer and the cited files so the team gets quick, sourced engineering answers.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'communication', 'team'],
      alsoIntegrations: ['greptile'],
    },
    {
      icon: SlackIcon,
      title: 'Slack knowledge search',
      prompt:
        'Create a knowledge base connected to my Slack workspace so all channel conversations and threads are automatically synced and searchable. Then build an agent I can ask things like "what did the team decide about the launch date?" or "what was the outcome of the design review?" and get answers with links to the original messages.',
      modules: ['knowledge-base', 'agent'],
      category: 'productivity',
      tags: ['team', 'research', 'communication'],
    },
    {
      icon: File,
      title: 'Slack narrative report',
      prompt:
        'Build a scheduled workflow that pulls key data from my tables every week, analyzes trends and anomalies, and writes a narrative report — not just charts and numbers, but written insights explaining what changed, why it matters, and what to do next. Save it as a document and send a summary to Slack.',
      modules: ['tables', 'scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['founder', 'reporting', 'analysis'],
    },
    {
      icon: BookOpen,
      title: 'Slack reading digest',
      prompt:
        'Create a scheduled daily workflow that searches the web for the latest articles, papers, and news on topics I care about, picks the top 5 most relevant pieces, writes a one-paragraph summary for each, and delivers a curated reading digest to my inbox or Slack.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research', 'content'],
    },
    {
      icon: ClipboardList,
      title: 'Slack standup summary',
      prompt:
        'Create a scheduled workflow that reads the #standup Slack channel each morning, summarizes what everyone is working on, identifies blockers, and posts a structured recap to a Google Docs document.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting', 'communication'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: Users,
      title: 'Slack onboarding automation',
      prompt:
        "Build a workflow that when triggered with a new hire's info, creates their accounts, sends a personalized welcome message in Slack, schedules 1:1s with their team on Google Calendar, shares relevant onboarding docs from the knowledge base, and tracks completion in a table.",
      modules: ['knowledge-base', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation', 'team'],
      alsoIntegrations: ['google_calendar'],
    },
    {
      icon: Table,
      title: 'Slack customer 360 alerts',
      prompt:
        'Create a comprehensive customer table that aggregates data from my CRM, support tickets, billing history, and product usage into a single unified view per customer. Schedule it to sync daily and send a Slack alert when any customer shows signs of trouble across multiple signals.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['founder', 'sales', 'support', 'enterprise', 'sync'],
    },
    {
      icon: GoogleTranslateIcon,
      title: 'Slack thread translator',
      prompt:
        'Build a workflow that watches international Slack channels, detects non-English messages, translates them with Google Translate, and posts the English version in a thread so the wider team stays in the loop.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'communication'],
      alsoIntegrations: ['google_translate'],
    },

    {
      icon: SlackIcon,
      title: 'Archive Slack conversations to Notion',
      prompt:
        'Build a workflow that captures important Slack messages and threads and saves them as Notion pages or database entries, so meeting notes and decisions are always documented.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['notion'],
    },
  ],
  skills: [
    {
      name: 'daily-standup-summary',
      description:
        'Read a standup channel and post a structured recap of progress, plans, and blockers.',
      content:
        '# Daily Standup Summary\n\nRead the messages posted in the standup channel since the last working day and produce a concise team recap.\n\n## Steps\n1. Collect every standup update in the channel from the relevant window (skip bot and off-topic messages).\n2. Group the content into three sections:\n   - **Done** — what was completed.\n   - **Today** — what each person plans to work on.\n   - **Blockers** — anything waiting on someone else, with the owner @-mentioned.\n3. Call out anyone who did not post an update.\n\n## Output\nPost a single threaded message with the three sections as bullet lists. Keep each bullet to one line. Lead with blockers if any exist so they are not missed.',
    },
    {
      name: 'channel-catch-up',
      description: 'Summarize what happened in a busy Slack channel so you can catch up fast.',
      content:
        '# Channel Catch-Up\n\nSummarize recent activity in a Slack channel for someone who has been away.\n\n## Steps\n1. Pull messages from the requested time range (default: since the user was last active, or the last 24 hours).\n2. Cluster the conversation into topics or threads rather than listing messages chronologically.\n3. For each topic, capture: the gist, any decision reached, and open questions still unanswered.\n\n## Output\n- A 1-sentence TL;DR.\n- A bulleted list of topics, each with **Decision:** and **Open:** lines where relevant.\n- A final "Needs your input" list of items where the user was @-mentioned or a question is unresolved.\nLink to the source thread for each topic.',
    },
    {
      name: 'slack-question-responder',
      description:
        'Watch a channel for questions and draft sourced, in-thread answers from your knowledge base.',
      content:
        '# Slack Question Responder\n\nMonitor a support or help channel and answer incoming questions.\n\n## Steps\n1. Detect when a message is a genuine question (ends in a question mark, asks "how/where/can someone", or is a help request).\n2. Search the connected knowledge base for the answer.\n3. If a confident answer exists, draft a concise reply in the thread with the answer and a citation/link to the source.\n4. If no confident answer exists, do not guess — post a short note that a human should help, and @-mention the channel owner.\n\n## Guidance\n- Always reply in-thread, never in the main channel.\n- Keep answers to 2–4 sentences plus the source link.\n- Never fabricate links or policy.',
    },
    {
      name: 'escalate-urgent-messages',
      description:
        'Scan a channel for urgent or at-risk messages and surface them to the right owner.',
      content:
        '# Escalate Urgent Messages\n\nTriage a channel for messages that need fast attention.\n\n## Steps\n1. Review recent messages and classify each as **Urgent**, **Today**, or **FYI** based on signals like "blocked", "down", "ASAP", customer impact, or an unanswered direct ask.\n2. For Urgent items, identify the most likely owner from the channel topic or message context.\n3. Skip resolved threads (those with a ✅ reaction or a clear answer).\n\n## Output\nPost a short escalation summary listing only Urgent and Today items: each as a one-line description, an @-mention of the owner, and a link to the message. If nothing is urgent, say so in one line.',
    },
  ],
} as const satisfies BlockMeta

const SLACK_WEBHOOK_TRIGGER_SUBBLOCK_IDS = new Set(
  getTrigger('slack_webhook').subBlocks.map((sb) => sb.id)
)

/**
 * Adapts a v1 subblock for slack_v2's merged credential picker: fields gated on
 * the removed `authMethod` dropdown now depend on the single `credential` field.
 */
function adaptSubBlockForV2(sb: SubBlockConfig): SubBlockConfig {
  const { dependsOn, condition, ...rest } = sb
  if (sb.id === 'credential') {
    return { ...rest, credentialKind: 'any', placeholder: 'Select Slack account or bot' }
  }
  if (sb.id === 'manualCredential') {
    return { ...rest, placeholder: 'Enter credential ID' }
  }
  if (dependsOn && !Array.isArray(dependsOn) && dependsOn.all?.includes('authMethod')) {
    return { ...sb, dependsOn: ['credential'] }
  }
  return sb
}

const {
  authMethod: _authMethod,
  botToken: _botToken,
  botCredential: _botCredential,
  ...slackV2Inputs
} = SlackBlock.inputs

/**
 * slack_v2 — the go-forward Slack action block. Identical operations, tools, and
 * outputs to v1 (shared by reference), but auth is a single credential picker
 * listing Sim OAuth accounts and reusable custom bots together — the credential's
 * kind is resolved server-side, so no auth-method choice is needed. Also hosts
 * the redesigned slack_oauth trigger (v1 keeps the legacy slack_webhook).
 */
export const SlackV2Block: BlockConfig<SlackResponse> = {
  ...SlackBlock,
  type: 'slack_v2',
  hideFromToolbar: false,
  // Preview-gated: hidden from every discovery surface until revealed via the
  // block-visibility AppConfig (hosted) or PREVIEW_BLOCKS=slack_v2 (dev /
  // self-host). At GA: drop this flag, add SlackV2BlockMeta + docs, and set
  // hideFromToolbar on v1.
  preview: true,
  subBlocks: [
    ...SlackBlock.subBlocks.flatMap((sb) => {
      // Drop the legacy paste-secret trigger config (v1 hosts slack_webhook)
      // and v1's raw bot-token auth field — the trigger set includes an
      // id-colliding 'botToken', so the set check covers both. The authMethod
      // dropdown is gone: the merged credential picker covers both auth kinds.
      if (SLACK_WEBHOOK_TRIGGER_SUBBLOCK_IDS.has(sb.id)) return []
      if (sb.id === 'authMethod') return []
      return [adaptSubBlockForV2(sb)]
    }),
    ...getTrigger('slack_oauth').subBlocks,
  ],
  inputs: {
    ...slackV2Inputs,
    oauthCredential: { type: 'string', description: 'Slack credential (OAuth account or bot)' },
  },
  triggers: {
    enabled: true,
    available: ['slack_oauth'],
  },
}
