import { OtterIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const CONVERSATION_ID_OPERATIONS = ['get_conversation', 'get_conversation_audio']
const PAGINATED_OPERATIONS = ['list_conversations', 'list_workspace_conversations']

export const OtterBlock: BlockConfig = {
  type: 'otter',
  name: 'Otter.ai',
  description: 'Read Otter.ai meeting conversations, transcripts, and summaries',
  longDescription:
    'Integrate Otter.ai into your workflow to list and read meeting conversations with their summaries, action items, insights, outlines, and transcripts, get audio download links, import recordings, and browse channels and workspace details. Otter can also trigger workflows when a conversation finishes processing or is shared. Requires an Otter Enterprise workspace.',
  docsLink: 'https://docs.sim.ai/integrations/otter',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#FFFFFF',
  icon: OtterIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Otter.ai',
    triggerSentences: {
      byTrigger: {
        otter_conversation_completed: ['Run when a conversation finishes processing'],
        otter_conversation_shared: ['Run when a conversation is shared'],
        otter_webhook: ['Run on any webhook event'],
      },
    },
    sentences: {
      byOperation: {
        list_conversations: [
          'List conversations',
          { text: 'in channel', field: 'channelId' },
          { text: ', up to', field: 'limit', after: 'per page' },
        ],
        get_conversation: [{ text: 'Read conversation', field: 'conversationId', core: true }],
        get_conversation_audio: [
          { text: 'Get audio link for conversation', field: 'conversationId', core: true },
        ],
        create_conversation: [
          { text: 'Import recording', field: 'fileUrl', core: true },
          { text: 'as', field: 'name' },
        ],
        list_channels: ['List channels'],
        list_channel_members: [{ text: 'List members of channel', field: 'channelId', core: true }],
        get_workspace: ['Get workspace details'],
        list_workspace_conversations: [
          { text: 'List every conversation in workspace', field: 'workspaceId', core: true },
        ],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Conversations', id: 'list_conversations' },
        { label: 'Get Conversation', id: 'get_conversation' },
        { label: 'Get Conversation Audio', id: 'get_conversation_audio' },
        { label: 'Import Recording', id: 'create_conversation' },
        { label: 'List Channels', id: 'list_channels' },
        { label: 'List Channel Members', id: 'list_channel_members' },
        { label: 'Get Workspace', id: 'get_workspace' },
        { label: 'List Workspace Conversations', id: 'list_workspace_conversations' },
      ],
      value: () => 'list_conversations',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Otter API key',
      password: true,
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      required: { field: 'operation', value: CONVERSATION_ID_OPERATIONS },
      placeholder: 'e.g., the ID in otter.ai/u/<id>',
      condition: { field: 'operation', value: CONVERSATION_ID_OPERATIONS },
    },
    {
      id: 'includeSelection',
      title: 'Include',
      type: 'dropdown',
      canonicalParamId: 'include',
      mode: 'basic',
      options: [
        { label: 'Everything', id: 'all' },
        { label: 'Transcript', id: 'transcript' },
        { label: 'Action Items', id: 'action_items' },
        { label: 'Insights', id: 'insights' },
        { label: 'Outline', id: 'outline' },
      ],
      value: () => 'all',
      required: { field: 'operation', value: 'get_conversation' },
      condition: { field: 'operation', value: 'get_conversation' },
    },
    {
      id: 'includeList',
      title: 'Include',
      type: 'short-input',
      canonicalParamId: 'include',
      mode: 'advanced',
      placeholder: 'e.g., insights,transcript',
      description:
        'Comma-separated related data to include: action_items, insights, outline, transcript, or all.',
      required: { field: 'operation', value: 'get_conversation' },
      condition: { field: 'operation', value: 'get_conversation' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of Otter conversation data to include, choosing only from: action_items, insights, outline, transcript, all. Use "all" only when everything is needed. Return ONLY the comma-separated list, with no spaces or extra text.',
        placeholder: 'Describe what you need from the conversation...',
      },
    },
    {
      id: 'fileUrl',
      title: 'File URL',
      type: 'short-input',
      required: { field: 'operation', value: 'create_conversation' },
      placeholder: 'https://example.com/call.mp4',
      description: 'Publicly reachable URL of the audio or video recording to import.',
      condition: { field: 'operation', value: 'create_conversation' },
    },
    {
      id: 'name',
      title: 'Conversation Name',
      type: 'short-input',
      placeholder: 'e.g., Product Launch Meeting',
      condition: { field: 'operation', value: 'create_conversation' },
    },
    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      required: { field: 'operation', value: 'list_channel_members' },
      placeholder: 'Channel ID from List Channels',
      description:
        'For List Conversations, returns only conversations in this channel (shared conversations included).',
      condition: { field: 'operation', value: ['list_conversations', 'list_channel_members'] },
    },
    {
      id: 'includeShared',
      title: 'Include Shared Conversations',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      placeholder: 'No (default)',
      description: 'Also return conversations shared with you. Ignored when a channel ID is set.',
      condition: { field: 'operation', value: 'list_conversations' },
      mode: 'advanced',
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      required: { field: 'operation', value: 'list_workspace_conversations' },
      placeholder: 'e.g., 42 (from Get Workspace)',
      description: 'Requires an Otter Super Admin API key.',
      condition: { field: 'operation', value: 'list_workspace_conversations' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '1-100',
      description: 'Conversations per page (1-100).',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous response',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
      mode: 'advanced',
    },
    ...getTrigger('otter_conversation_completed').subBlocks,
    ...getTrigger('otter_conversation_shared').subBlocks,
    ...getTrigger('otter_webhook').subBlocks,
  ],

  tools: {
    access: [
      'otter_list_conversations',
      'otter_get_conversation',
      'otter_get_conversation_audio',
      'otter_create_conversation',
      'otter_list_channels',
      'otter_list_channel_members',
      'otter_get_workspace',
      'otter_list_workspace_conversations',
    ],
    config: {
      tool: (params) => `otter_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.limit !== undefined && params.limit !== null && params.limit !== '') {
          result.limit = Number(params.limit)
        }
        if (
          params.operation === 'list_conversations' &&
          params.includeShared !== undefined &&
          params.includeShared !== null &&
          params.includeShared !== ''
        ) {
          result.includeShared = params.includeShared === true || params.includeShared === 'true'
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Otter API key' },
    conversationId: { type: 'string', description: 'Otter conversation ID' },
    include: {
      type: 'string',
      description:
        'Comma-separated related data for Get Conversation: action_items, insights, outline, transcript, or all',
    },
    fileUrl: { type: 'string', description: 'URL of the recording to import' },
    name: { type: 'string', description: 'Name for the imported conversation' },
    channelId: { type: 'string', description: 'Otter channel ID' },
    includeShared: {
      type: 'boolean',
      description: 'Whether to include conversations shared with the user',
    },
    workspaceId: { type: 'string', description: 'Otter workspace ID' },
    limit: { type: 'number', description: 'Conversations per page (1-100)' },
    cursor: { type: 'string', description: 'Pagination cursor' },
  },

  outputs: {
    conversations: {
      type: 'json',
      description:
        'Conversations (id, title, url, owner, createdAt, processStatus, calendarGuests, sharedEmails, sharedChannels, abstractSummary, confJoinUrl)',
    },
    hasMore: { type: 'boolean', description: 'Whether more conversations are available' },
    nextCursor: { type: 'string', description: 'Cursor for the next page' },
    retrievedAt: { type: 'string', description: 'When Otter retrieved the data (ISO 8601)' },
    id: {
      type: 'string',
      description: 'Conversation ID',
    },
    title: { type: 'string', description: 'Conversation title' },
    url: { type: 'string', description: 'URL to view the conversation in Otter' },
    owner: {
      type: 'json',
      description: 'Conversation or workspace owner (id, name, firstName, lastName, email)',
    },
    createdAt: { type: 'string', description: 'When the conversation was created' },
    processStatus: {
      type: 'json',
      description: 'Processing status of generated data (abstractSummary, actionItem, outline)',
    },
    calendarGuests: {
      type: 'json',
      description: 'Calendar event guests (name, email, permission)',
    },
    sharedEmails: {
      type: 'json',
      description: 'Users or emails the conversation is shared with (email, user, permission)',
    },
    sharedChannels: {
      type: 'json',
      description: 'Channels the conversation is shared with (channel, permission)',
    },
    abstractSummary: { type: 'string', description: 'AI-generated summary of the conversation' },
    confJoinUrl: { type: 'string', description: 'Meeting join URL' },
    actionItems: {
      type: 'json',
      description:
        'Action items (id, text, assignee, status {completed, createdAt, lastModifiedAt, completedAt})',
    },
    insights: { type: 'json', description: 'Key topics discussed (topic, text[])' },
    outline: { type: 'json', description: 'Meeting outline sections (section, text[])' },
    transcript: { type: 'json', description: 'Full transcript (content, format)' },
    customPrompt: { type: 'json', description: 'Custom prompt output (label, output)' },
    audioUrl: { type: 'string', description: 'Download URL for the conversation MP3 audio' },
    status: { type: 'string', description: 'Import status (e.g., success)' },
    completedAt: { type: 'string', description: 'When the import completed' },
    file: { type: 'string', description: 'Name of the imported file' },
    channels: {
      type: 'json',
      description: 'Channels (id, name, memberCount, owner, discoverability)',
    },
    members: {
      type: 'json',
      description: 'Channel members (id, name, firstName, lastName, email)',
    },
    workspaceId: {
      type: 'number',
      description: 'Workspace ID from Get Workspace; pass it to List Workspace Conversations',
    },
    name: { type: 'string', description: 'Workspace name' },
    memberCount: { type: 'number', description: 'Number of workspace members' },
    handle: { type: 'string', description: 'Workspace handle (e.g., a domain)' },
    type: { type: 'string', description: 'Workspace type (e.g., business)' },
  },

  triggers: {
    enabled: true,
    available: ['otter_conversation_completed', 'otter_conversation_shared', 'otter_webhook'],
  },
}

export const OtterBlockMeta = {
  tags: ['meeting', 'note-taking', 'speech-to-text'],
  url: 'https://otter.ai',
  templates: [
    {
      icon: OtterIcon,
      title: 'Otter meeting recap to Slack',
      prompt:
        'Build a workflow that runs when an Otter conversation finishes processing, turns its summary, action items, and insights into a short recap, and posts it to the team Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
      featured: true,
    },
    {
      icon: OtterIcon,
      title: 'Otter sales call to CRM',
      prompt:
        'Create a workflow triggered by an Otter conversation shared to the sales calls channel that matches calendar guests to HubSpot contacts and logs the meeting summary and next steps on the deal.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: OtterIcon,
      title: 'Otter action items to Linear',
      prompt:
        'Build a workflow that reads the action items of each completed Otter conversation and creates a Linear issue for every item, assigned to the matching teammate by email.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['team', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: OtterIcon,
      title: 'Otter transcripts to knowledge base',
      prompt:
        'Create a scheduled workflow that lists new Otter conversations each day, fetches their transcripts and outlines, and adds them to a knowledge base so agents can answer questions about past meetings.',
      modules: ['scheduled', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['team', 'research'],
    },
    {
      icon: OtterIcon,
      title: 'Otter dialer call import',
      prompt:
        'Build a workflow that takes call recording URLs from a dialer export in a table and imports each one into Otter as a named conversation, recording the import status back in the table.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: OtterIcon,
      title: 'Otter customer insight log',
      prompt:
        'Create a workflow that runs on every completed Otter customer call, extracts pain points, objections, and feature requests from the insights and transcript, and appends them to a research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: OtterIcon,
      title: 'Otter weekly meeting digest',
      prompt:
        'Build a scheduled weekly workflow that lists the week’s Otter conversations in a channel, summarizes recurring themes and decisions from their outlines, and emails the digest to the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'recap-otter-meeting',
      description:
        'Read an Otter conversation and write a recap with the summary, decisions, and action items with owners.',
      content:
        '# Recap Otter Meeting\n\nTurn one Otter conversation into a shareable recap.\n\n## Steps\n1. If only a title is known, list conversations and match it to find the conversation ID.\n2. Get the conversation, including action items, insights, and outline.\n3. Use the abstract summary as the overview, the insights for decisions and risks, and the action items for follow-ups with their assignees.\n\n## Output\nReturn the meeting title, a short overview, key decisions, and a list of action items with owners and completion status, plus the Otter link.',
    },
    {
      name: 'sync-meeting-to-crm',
      description:
        'Prepare an Otter sales conversation for a CRM update, matching calendar guests to contacts.',
      content:
        '# Sync Meeting to CRM\n\nOtter recommends matching calendar guests to CRM contacts when syncing meetings.\n\n## Steps\n1. Get the conversation with action items and insights.\n2. Collect the calendar guest emails and the owner.\n3. Draft a CRM note from the abstract summary and insights, and list next steps from the action items.\n\n## Output\nReturn the guest emails to match, the CRM note text, and the next steps, ready to write to the CRM record.',
    },
    {
      name: 'extract-otter-action-items',
      description:
        'Pull the action items from an Otter conversation into clean tasks for a project management tool.',
      content:
        '# Extract Otter Action Items\n\nConvert Otter action items into tasks.\n\n## Steps\n1. Get the conversation, including action items.\n2. Keep items that are not completed.\n3. For each, write a task title from the text and use the assignee email as the owner.\n\n## Output\nReturn a list of tasks with title, owner email, and a link back to the Otter conversation.',
    },
    {
      name: 'audit-workspace-conversations',
      description:
        'As an Otter Super Admin, page through every conversation in the workspace and summarize activity.',
      content:
        '# Audit Workspace Conversations\n\nReview meeting activity across an Otter workspace (Super Admin only).\n\n## Steps\n1. Get the workspace to find its ID.\n2. List workspace conversations, following nextCursor while hasMore is true.\n3. Group conversations by owner and note which have summaries finished.\n\n## Output\nReturn conversation counts per owner, the most recent meetings, and any conversations still processing.',
    },
  ],
} as const satisfies BlockMeta
