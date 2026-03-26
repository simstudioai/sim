import { GranolaIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'

export const GranolaBlock: BlockConfig = {
  type: 'granola',
  name: 'Granola',
  description: 'Access meeting notes and transcripts from Granola',
  longDescription:
    'Integrate Granola into your workflow to retrieve meeting notes, summaries, attendees, and transcripts.',
  docsLink: 'https://docs.sim.ai/tools/granola',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  tags: ['meeting', 'note-taking'],
  bgColor: '#B2C147',
  icon: GranolaIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Notes', id: 'list_notes' },
        { label: 'Get Note', id: 'get_note' },
      ],
      value: () => 'list_notes',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Granola API key',
      password: true,
    },
    {
      id: 'noteId',
      title: 'Note ID',
      type: 'short-input',
      required: { field: 'operation', value: 'get_note' },
      placeholder: 'e.g., not_1d3tmYTlCICgjy',
      condition: { field: 'operation', value: 'get_note' },
    },
    {
      id: 'includeTranscript',
      title: 'Include Transcript',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'get_note' },
      mode: 'advanced',
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      placeholder: 'e.g., 2026-01-01',
      condition: { field: 'operation', value: 'list_notes' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date or datetime string. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'createdBefore',
      title: 'Created Before',
      type: 'short-input',
      placeholder: 'e.g., 2026-03-01',
      condition: { field: 'operation', value: 'list_notes' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date or datetime string. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'updatedAfter',
      title: 'Updated After',
      type: 'short-input',
      placeholder: 'e.g., 2026-01-01',
      condition: { field: 'operation', value: 'list_notes' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date or datetime string. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '10 (1-30)',
      condition: { field: 'operation', value: 'list_notes' },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      condition: { field: 'operation', value: 'list_notes' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: ['granola_list_notes', 'granola_get_note'],
    config: {
      tool: (params) => `granola_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.pageSize) result.pageSize = Number(params.pageSize)
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Granola API key' },
    noteId: { type: 'string', description: 'Note ID for get_note operation' },
    includeTranscript: { type: 'string', description: 'Whether to include transcript' },
    createdAfter: { type: 'string', description: 'Filter notes created after this date' },
    createdBefore: { type: 'string', description: 'Filter notes created before this date' },
    updatedAfter: { type: 'string', description: 'Filter notes updated after this date' },
    pageSize: { type: 'number', description: 'Results per page (1-30)' },
    cursor: { type: 'string', description: 'Pagination cursor' },
  },

  outputs: {
    notes: {
      type: 'json',
      description: 'List of meeting notes (id, title, ownerName, ownerEmail, createdAt, updatedAt)',
    },
    hasMore: { type: 'boolean', description: 'Whether more notes are available' },
    cursor: { type: 'string', description: 'Pagination cursor for next page' },
    id: { type: 'string', description: 'Note ID' },
    title: { type: 'string', description: 'Note title' },
    ownerName: { type: 'string', description: 'Note owner name' },
    ownerEmail: { type: 'string', description: 'Note owner email' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    summaryText: { type: 'string', description: 'Plain text meeting summary' },
    summaryMarkdown: { type: 'string', description: 'Markdown meeting summary' },
    attendees: { type: 'json', description: 'Meeting attendees (name, email)' },
    folders: { type: 'json', description: 'Folders the note belongs to (id, name)' },
    calendarEventTitle: { type: 'string', description: 'Calendar event title' },
    calendarOrganiser: { type: 'string', description: 'Calendar event organiser email' },
    calendarEventId: { type: 'string', description: 'Calendar event ID' },
    scheduledStartTime: { type: 'string', description: 'Scheduled start time' },
    scheduledEndTime: { type: 'string', description: 'Scheduled end time' },
    invitees: { type: 'json', description: 'Calendar event invitee emails' },
    transcript: {
      type: 'json',
      description: 'Meeting transcript entries (speaker, text, startTime, endTime)',
    },
  },
}
