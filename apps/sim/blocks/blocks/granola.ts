import { GranolaIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'

export const GranolaBlock: BlockConfig = {
  type: 'granola',
  name: 'Granola',
  description: 'Access meeting notes and transcripts from Granola',
  longDescription:
    'Integrate Granola into your workflow to retrieve meeting notes, summaries, attendees, and transcripts.',
  docsLink: 'https://docs.sim.ai/tools/granola',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
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

export const GranolaBlockMeta = {
  tags: ['meeting', 'note-taking'],
  templates: [
    {
      icon: GranolaIcon,
      title: 'Granola meeting brief',
      prompt:
        'Build a workflow that runs before a Granola meeting, researches attendees and topic, and updates the Granola pre-meeting note with the prep brief.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['sales', 'research'],
      alsoIntegrations: ['apollo'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola action-item ticket creator',
      prompt:
        'Create a workflow that extracts action items from Granola meeting notes, creates Linear or Asana tasks for each with owners and due dates, and posts a summary to Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['linear', 'asana'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola CRM updater',
      prompt:
        'Build a workflow that runs after a Granola sales meeting, summarizes the meeting notes into a deal-ready summary, and updates the linked Salesforce or HubSpot opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce', 'hubspot'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola weekly digest',
      prompt:
        'Create a scheduled weekly workflow that aggregates Granola meeting notes, identifies recurring themes and decisions, and writes a digest to the team Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola + Notion publisher',
      prompt:
        'Build a workflow that watches Granola meetings, generates a polished meeting-notes page in Notion under the right team space, and links the original Granola note.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola customer-interview extractor',
      prompt:
        'Create a workflow that processes Granola customer-interview notes, extracts notable quotes and pain points, and writes them to a tables-based research log.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: GranolaIcon,
      title: 'Granola decision-log keeper',
      prompt:
        'Build a workflow that scans Granola meeting notes for decisions made, writes each to a tables-based decision log with date, owner, and context, and shares the link.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
    },
  ],
} as const satisfies BlockMeta
