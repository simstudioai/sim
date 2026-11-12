import { WebexIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const WebexBlock: BlockConfig = {
  type: 'webex',
  name: 'Webex',
  description: 'Send messages, manage rooms and schedule Webex meetings',
  longDescription:
    'Connect your Webex account to send and read messages, manage rooms and room members, look up people, and schedule, update, and cancel meetings from your workflows.',
  docsLink: 'https://docs.sim.ai/integrations/webex',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  authMode: AuthMode.OAuth,
  bgColor: '#00BCEB',
  icon: WebexIcon,
  canvasPresentation: {
    defaultTitle: 'Webex',
    sentences: {
      byOperation: {
        webex_send_message: [
          { text: 'Post', field: 'text', core: true },
          { text: 'to', field: 'roomId', core: true },
        ],
        webex_list_messages: ['List messages', { text: 'in', field: 'roomId' }],
        webex_get_message: [{ text: 'Read message', field: 'messageId', core: true }],
        webex_delete_message: [{ text: 'Delete message', field: 'messageId', core: true }],
        webex_list_rooms: ['List rooms', { text: 'of type', field: 'roomType' }],
        webex_create_room: [{ text: 'Create room', field: 'roomTitle', core: true }],
        webex_get_room: [{ text: 'Read room', field: 'roomIdDetail', core: true }],
        webex_list_members: [{ text: 'List members of room', field: 'roomIdDetail', core: true }],
        webex_get_person: [{ text: 'Read person', field: 'personId', core: true }],
        webex_create_meeting: [
          { text: 'Create meeting', field: 'meetingTitle', core: true },
          { text: 'starting', field: 'startTime' },
        ],
        webex_list_meetings: ['List scheduled meetings'],
        webex_get_meeting: [{ text: 'Read meeting', field: 'meetingId', core: true }],
        webex_update_meeting: [{ text: 'Update meeting', field: 'meetingId', core: true }],
        webex_delete_meeting: [{ text: 'Delete meeting', field: 'meetingId', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Message', id: 'webex_send_message' },
        { label: 'List Messages', id: 'webex_list_messages' },
        { label: 'Get Message', id: 'webex_get_message' },
        { label: 'Delete Message', id: 'webex_delete_message' },
        { label: 'List Rooms', id: 'webex_list_rooms' },
        { label: 'Create Room', id: 'webex_create_room' },
        { label: 'Get Room', id: 'webex_get_room' },
        { label: 'List Room Members', id: 'webex_list_members' },
        { label: 'Get Person', id: 'webex_get_person' },
        { label: 'Create Meeting', id: 'webex_create_meeting' },
        { label: 'List Meetings', id: 'webex_list_meetings' },
        { label: 'Get Meeting', id: 'webex_get_meeting' },
        { label: 'Update Meeting', id: 'webex_update_meeting' },
        { label: 'Delete Meeting', id: 'webex_delete_meeting' },
      ],
      value: () => 'webex_list_rooms',
    },
    {
      id: 'credential',
      title: 'Webex Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'webex',
      requiredScopes: getScopesForService('webex'),
      mode: 'basic',
      placeholder: 'Select Webex account',
      required: true,
      paramVisibility: 'user-only',
    },
    {
      id: 'manualCredential',
      title: 'Webex Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter Webex credential ID',
      required: true,
      paramVisibility: 'user-only',
    },
    {
      id: 'roomId',
      title: 'Room ID',
      type: 'short-input',
      placeholder: 'Y2lzY29zcGFyazovL3Vz...',
      condition: {
        field: 'operation',
        value: [
          'webex_send_message',
          'webex_list_messages',
          'webex_get_message',
          'webex_delete_message',
        ],
      },
    },
    {
      id: 'toPersonEmail',
      title: 'To Person Email (DM)',
      type: 'short-input',
      placeholder: 'user@example.com',
      condition: { field: 'operation', value: 'webex_send_message' },
    },
    {
      id: 'text',
      title: 'Message Text',
      type: 'long-input',
      placeholder: 'Hello team!',
      condition: { field: 'operation', value: 'webex_send_message' },
    },
    {
      id: 'markdown',
      title: 'Message (Markdown)',
      type: 'long-input',
      placeholder: '**Hello** team!',
      condition: { field: 'operation', value: 'webex_send_message' },
    },
    {
      id: 'max',
      title: 'Max Messages',
      type: 'short-input',
      placeholder: '50',
      mode: 'advanced',
      condition: { field: 'operation', value: 'webex_list_messages' },
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Y2lzY29zcGFyazovL3Vz...',
      condition: {
        field: 'operation',
        value: ['webex_get_message', 'webex_delete_message'],
      },
    },
    {
      id: 'roomTitle',
      title: 'Room Title',
      type: 'short-input',
      placeholder: 'Project Alpha',
      required: true,
      condition: { field: 'operation', value: 'webex_create_room' },
    },
    {
      id: 'roomType',
      title: 'Room Type Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Direct', id: 'direct' },
        { label: 'Group', id: 'group' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'webex_list_rooms' },
    },
    {
      id: 'roomIdDetail',
      title: 'Room ID',
      type: 'short-input',
      placeholder: 'Y2lzY29zcGFyazovL3Vz...',
      required: true,
      condition: { field: 'operation', value: ['webex_get_room', 'webex_list_members'] },
    },
    {
      id: 'personId',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'me',
      required: true,
      condition: { field: 'operation', value: 'webex_get_person' },
    },
    {
      id: 'meetingTitle',
      title: 'Meeting Title',
      type: 'short-input',
      placeholder: 'Weekly Standup',
      required: true,
      condition: {
        field: 'operation',
        value: ['webex_create_meeting', 'webex_update_meeting'],
      },
    },
    {
      id: 'startTime',
      title: 'Start Time (ISO 8601)',
      type: 'short-input',
      placeholder: '2026-03-01T10:00:00Z',
      required: true,
      condition: {
        field: 'operation',
        value: ['webex_create_meeting', 'webex_update_meeting'],
      },
    },
    {
      id: 'endTime',
      title: 'End Time (ISO 8601)',
      type: 'short-input',
      placeholder: '2026-03-01T11:00:00Z',
      required: true,
      condition: {
        field: 'operation',
        value: ['webex_create_meeting', 'webex_update_meeting'],
      },
    },
    {
      id: 'agenda',
      title: 'Agenda',
      type: 'long-input',
      placeholder: 'Weekly sync to review progress...',
      condition: {
        field: 'operation',
        value: ['webex_create_meeting', 'webex_update_meeting'],
      },
    },
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'UTC',
      condition: {
        field: 'operation',
        value: ['webex_create_meeting', 'webex_update_meeting'],
      },
    },
    {
      id: 'meetingInvitees',
      title: 'Invitees (comma-separated emails)',
      type: 'short-input',
      placeholder: 'alice@example.com, bob@example.com',
      condition: { field: 'operation', value: 'webex_create_meeting' },
    },
    {
      id: 'meetingId',
      title: 'Meeting ID',
      type: 'short-input',
      placeholder: 'a1b2c3d4...',
      required: true,
      condition: {
        field: 'operation',
        value: ['webex_get_meeting', 'webex_update_meeting', 'webex_delete_meeting'],
      },
    },
  ],
  tools: {
    access: [
      'webex_send_message',
      'webex_list_messages',
      'webex_get_message',
      'webex_delete_message',
      'webex_list_rooms',
      'webex_create_room',
      'webex_get_room',
      'webex_list_members',
      'webex_get_person',
      'webex_create_meeting',
      'webex_list_meetings',
      'webex_get_meeting',
      'webex_update_meeting',
      'webex_delete_meeting',
    ],
    config: {
      tool: (params) => params.operation as string,
      params: (params) => {
        const mapped: Record<string, unknown> = {}

        if (params.roomId) mapped.roomId = params.roomId
        if (params.toPersonEmail) mapped.toPersonEmail = params.toPersonEmail
        if (params.text) mapped.text = params.text
        if (params.markdown) mapped.markdown = params.markdown
        if (params.max) mapped.max = Number(params.max)
        if (params.messageId) mapped.messageId = params.messageId

        if (params.roomTitle) mapped.title = params.roomTitle
        if (params.roomType) mapped.type = params.roomType
        if (params.roomIdDetail) mapped.roomId = params.roomIdDetail

        if (params.personId) mapped.personId = params.personId

        if (params.meetingTitle) mapped.title = params.meetingTitle
        if (params.startTime) mapped.start = params.startTime
        if (params.endTime) mapped.end = params.endTime
        if (params.agenda) mapped.agenda = params.agenda
        if (params.timezone) mapped.timezone = params.timezone
        if (params.meetingInvitees) mapped.invitees = params.meetingInvitees
        if (params.meetingId) mapped.meetingId = params.meetingId

        return mapped
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Webex action to perform' },
    oauthCredential: { type: 'string', description: 'Delegated Webex credential ID' },
    roomId: { type: 'string', description: 'Webex room (space) ID' },
    toPersonEmail: { type: 'string', description: 'Email address for a direct message' },
    text: { type: 'string', description: 'Plain text message content' },
    markdown: { type: 'string', description: 'Markdown message content' },
    max: { type: 'number', description: 'Maximum number of messages to return' },
    messageId: { type: 'string', description: 'Webex message ID' },
    roomTitle: { type: 'string', description: 'Title for a newly created room' },
    roomType: { type: 'string', description: 'Room type filter for listing rooms' },
    roomIdDetail: { type: 'string', description: 'Webex room ID for reads' },
    personId: { type: 'string', description: 'Webex person ID' },
    meetingTitle: { type: 'string', description: 'Meeting title' },
    startTime: { type: 'string', description: 'Meeting start time (ISO 8601)' },
    endTime: { type: 'string', description: 'Meeting end time (ISO 8601)' },
    agenda: { type: 'string', description: 'Meeting agenda' },
    timezone: { type: 'string', description: 'Meeting timezone' },
    meetingInvitees: { type: 'string', description: 'Comma-separated invitee emails' },
    meetingId: { type: 'string', description: 'Webex meeting ID' },
  },
  outputs: {
    message: {
      type: 'json',
      description: 'Webex message with ID, room, sender, text, and creation time',
      condition: { field: 'operation', value: ['webex_send_message', 'webex_get_message'] },
    },
    messages: {
      type: 'json',
      description: 'Messages from a room, each with ID, sender, text, and creation time',
      condition: { field: 'operation', value: 'webex_list_messages' },
    },
    rooms: {
      type: 'json',
      description: 'Webex rooms with ID, title, type, and membership details',
      condition: { field: 'operation', value: 'webex_list_rooms' },
    },
    room: {
      type: 'json',
      description: 'Webex room with ID, title, type, and timestamps',
      condition: { field: 'operation', value: ['webex_create_room', 'webex_get_room'] },
    },
    members: {
      type: 'json',
      description: 'Members of a room with person IDs, emails, and room roles',
      condition: { field: 'operation', value: 'webex_list_members' },
    },
    person: {
      type: 'json',
      description: 'Webex person profile with ID, display name, email, and avatar',
      condition: { field: 'operation', value: 'webex_get_person' },
    },
    meeting: {
      type: 'json',
      description: 'Webex meeting with ID, title, start and end time, and join URL',
      condition: {
        field: 'operation',
        value: [
          'webex_create_meeting',
          'webex_get_meeting',
          'webex_update_meeting',
          'webex_delete_meeting',
        ],
      },
    },
    meetings: {
      type: 'json',
      description: 'Scheduled Webex meetings with ID, title, and start time',
      condition: { field: 'operation', value: 'webex_list_meetings' },
    },
    deleted: {
      type: 'json',
      description: 'Deletion confirmation for a message or meeting',
      condition: {
        field: 'operation',
        value: ['webex_delete_message', 'webex_delete_meeting'],
      },
    },
  },
}

export const WebexBlockMeta = {
  tags: ['messaging', 'meeting', 'calendar', 'automation'],
  url: 'https://www.webex.com/',
  templates: [
    {
      icon: WebexIcon,
      title: 'Post release notes to Webex',
      prompt:
        "When a new release is published, read the changelog entry, write a short summary, and post it to the team's Webex room.",
      modules: ['workflows', 'agent'],
      category: 'engineering',
      tags: ['notifications', 'releases'],
      alsoIntegrations: ['github'],
    },
    {
      icon: WebexIcon,
      title: 'Daily standup room digest',
      prompt:
        'Every morning, list the latest messages in the standup Webex room, summarize what was discussed, and post the digest back to the same room.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['standup', 'summarize'],
    },
    {
      icon: WebexIcon,
      title: 'Schedule meetings from a form',
      prompt:
        'When a meeting request is submitted, create a Webex meeting with the requested title and times, then email the join link to each invitee.',
      modules: ['workflows', 'agent'],
      category: 'productivity',
      tags: ['scheduling', 'meetings'],
    },
    {
      icon: WebexIcon,
      title: 'Alert room for failed jobs',
      prompt:
        'When a CI job fails, send a message to the incident Webex room with the job name, branch, and failure log excerpt so the team can react immediately.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['alerts', 'ci'],
      alsoIntegrations: ['github'],
    },
    {
      icon: WebexIcon,
      title: 'Create a room per new customer',
      prompt:
        'When a customer signs up, create a dedicated Webex room named after the account and post a welcome message linking their onboarding checklist.',
      modules: ['workflows', 'agent'],
      category: 'sales',
      tags: ['onboarding', 'rooms'],
    },
    {
      icon: WebexIcon,
      title: 'Read room and answer questions',
      prompt:
        'Watch a support Webex room, read the newest question, look up the answer in the knowledge base, and reply in the same room.',
      modules: ['agent', 'knowledge-base'],
      category: 'support',
      tags: ['support', 'answers'],
    },
    {
      icon: WebexIcon,
      title: 'Weekly meeting list report',
      prompt:
        'Every Friday, list this week’s Webex meetings, group them by day, and post the schedule to the team room so everyone can plan the next week.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['meetings', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'post-release-notes-to-room',
      description: 'Turn a changelog entry into a short Webex announcement posted to a team room.',
      content: `# Post Release Notes to a Webex Room

## Steps
1. Read the release or changelog entry for the new version.
2. Summarize it in three to five bullet points a teammate can skim.
3. Send the summary as a message to the team's Webex room with the Webex block.

## Output
A single Webex message containing the release summary and the release link.

## Sources
[Webex Messages API](https://developer.webex.com/docs/api/v1/messages)
`,
    },
    {
      name: 'summarize-room-messages',
      description: 'Read the latest messages in a Webex room and post a concise digest back to it.',
      content: `# Summarize Webex Room Messages

## Steps
1. List the most recent messages from the target room with the Webex block.
2. Summarize decisions, action items, and open questions.
3. Post the digest back to the same room.

## Output
A Webex message with a short digest of the conversation.

## Sources
[Webex Messages API](https://developer.webex.com/docs/api/v1/messages)
`,
    },
    {
      name: 'schedule-meeting-for-request',
      description:
        'Create a Webex meeting from a request and share the join details with invitees.',
      content: `# Schedule a Webex Meeting

## Steps
1. Read the requested title, start time, and end time from the trigger payload.
2. Create the meeting with the Webex block.
3. Share the meeting join URL with the invitees.

## Output
The created Webex meeting, including its join URL.

## Sources
[Webex Meetings API](https://developer.webex.com/docs/api/v1/meetings)
`,
    },
    {
      name: 'announce-failure-to-room',
      description: 'Send an alert message to a Webex room when a monitored job or workflow fails.',
      content: `# Announce a Failure in a Webex Room

## Steps
1. Capture the failing job name, branch, and error excerpt from the trigger.
2. Compose a short alert message with the details.
3. Send it to the incident Webex room with the Webex block.

## Output
A Webex alert message in the incident room.

## Sources
[Webex Messages API](https://developer.webex.com/docs/api/v1/messages)
`,
    },
    {
      name: 'reply-to-room-question',
      description:
        'Read the newest question in a Webex room and answer it from your knowledge base.',
      content: `# Reply to a Question in a Webex Room

## Steps
1. List the latest messages in the room and identify the unanswered question.
2. Look up the answer in your knowledge base.
3. Post the answer as a reply message in the same room.

## Output
A Webex message answering the question.

## Sources
[Webex Messages API](https://developer.webex.com/docs/api/v1/messages)
`,
    },
    {
      name: 'list-weekly-meetings',
      description: "Collect this week's Webex meetings into a schedule summary for the team.",
      content: `# List Weekly Webex Meetings

## Steps
1. List scheduled Webex meetings with the Webex block.
2. Group the meetings by day and drop cancelled ones.
3. Post the weekly schedule to the team room.

## Output
A Webex message with the day-by-day meeting schedule.

## Sources
[Webex Meetings API](https://developer.webex.com/docs/api/v1/meetings)
`,
    },
  ],
} as const satisfies BlockMeta
