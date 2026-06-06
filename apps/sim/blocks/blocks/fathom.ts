import { FathomIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { FathomResponse } from '@/tools/fathom/types'
import { getTrigger } from '@/triggers'
import { fathomTriggerOptions } from '@/triggers/fathom/utils'

export const FathomBlock: BlockConfig<FathomResponse> = {
  type: 'fathom',
  name: 'Fathom',
  description: 'Access meeting recordings, transcripts, and summaries',
  authMode: AuthMode.ApiKey,
  triggerAllowed: true,
  longDescription:
    'Integrate Fathom AI Notetaker into your workflow. List meetings, get transcripts and summaries, and manage team members and teams. Can also trigger workflows when new meeting content is ready.',
  docsLink: 'https://docs.sim.ai/tools/fathom',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#181C1E',
  icon: FathomIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Meetings', id: 'fathom_list_meetings' },
        { label: 'Get Summary', id: 'fathom_get_summary' },
        { label: 'Get Transcript', id: 'fathom_get_transcript' },
        { label: 'List Team Members', id: 'fathom_list_team_members' },
        { label: 'List Teams', id: 'fathom_list_teams' },
      ],
      value: () => 'fathom_list_meetings',
    },
    {
      id: 'recordingId',
      title: 'Recording ID',
      type: 'short-input',
      required: { field: 'operation', value: ['fathom_get_summary', 'fathom_get_transcript'] },
      placeholder: 'Enter the recording ID',
      condition: { field: 'operation', value: ['fathom_get_summary', 'fathom_get_transcript'] },
    },
    {
      id: 'includeSummary',
      title: 'Include Summary',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'fathom_list_meetings' },
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
      condition: { field: 'operation', value: 'fathom_list_meetings' },
    },
    {
      id: 'includeActionItems',
      title: 'Include Action Items',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'fathom_list_meetings' },
    },
    {
      id: 'includeCrmMatches',
      title: 'Include CRM Matches',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'fathom_list_meetings' },
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (e.g., 2025-01-01T00:00:00Z)',
      condition: { field: 'operation', value: 'fathom_list_meetings' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'createdBefore',
      title: 'Created Before',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (e.g., 2025-12-31T23:59:59Z)',
      condition: { field: 'operation', value: 'fathom_list_meetings' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'recordedBy',
      title: 'Recorded By',
      type: 'short-input',
      placeholder: 'Filter by recorder email',
      condition: { field: 'operation', value: 'fathom_list_meetings' },
      mode: 'advanced',
    },
    {
      id: 'teams',
      title: 'Team',
      type: 'short-input',
      placeholder: 'Filter by team name',
      condition: {
        field: 'operation',
        value: ['fathom_list_meetings', 'fathom_list_team_members'],
      },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Pagination Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous response',
      condition: {
        field: 'operation',
        value: ['fathom_list_meetings', 'fathom_list_team_members', 'fathom_list_teams'],
      },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Fathom API key',
      password: true,
    },
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: fathomTriggerOptions,
      value: () => 'fathom_new_meeting',
      required: true,
    },
    ...getTrigger('fathom_new_meeting').subBlocks,
    ...getTrigger('fathom_webhook').subBlocks,
  ],
  tools: {
    access: [
      'fathom_list_meetings',
      'fathom_get_summary',
      'fathom_get_transcript',
      'fathom_list_team_members',
      'fathom_list_teams',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'fathom_list_meetings'
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Fathom API key' },
    recordingId: { type: 'string', description: 'Recording ID for summary or transcript' },
    includeSummary: { type: 'string', description: 'Include summary in meetings response' },
    includeTranscript: { type: 'string', description: 'Include transcript in meetings response' },
    includeActionItems: {
      type: 'string',
      description: 'Include action items in meetings response',
    },
    includeCrmMatches: {
      type: 'string',
      description: 'Include linked CRM matches in meetings response',
    },
    createdAfter: { type: 'string', description: 'Filter meetings created after this timestamp' },
    createdBefore: {
      type: 'string',
      description: 'Filter meetings created before this timestamp',
    },
    recordedBy: { type: 'string', description: 'Filter by recorder email' },
    teams: { type: 'string', description: 'Filter by team name' },
    cursor: { type: 'string', description: 'Pagination cursor for next page' },
  },
  outputs: {
    meetings: { type: 'json', description: 'List of meetings' },
    template_name: { type: 'string', description: 'Summary template name' },
    markdown_formatted: { type: 'string', description: 'Markdown-formatted summary' },
    transcript: { type: 'json', description: 'Meeting transcript entries' },
    members: { type: 'json', description: 'List of team members' },
    teams: { type: 'json', description: 'List of teams' },
    next_cursor: { type: 'string', description: 'Pagination cursor' },
  },
  triggers: {
    enabled: true,
    available: ['fathom_new_meeting', 'fathom_webhook'],
  },
}

export const FathomBlockMeta = {
  tags: ['meeting', 'note-taking'],
  templates: [
    {
      icon: FathomIcon,
      title: 'Fathom meeting recap to Slack',
      prompt:
        'Build a workflow that triggers when a Fathom meeting completes, pulls the summary and action items, and posts a recap to the relevant Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['meeting', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: FathomIcon,
      title: 'Fathom transcript to Notion notes',
      prompt:
        'Create a workflow that triggers on a new Fathom meeting, pulls the transcript and summary, and writes a structured meeting note to Notion with attendees and next steps.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['meeting', 'note-taking'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: FathomIcon,
      title: 'Fathom weekly meeting digest',
      prompt:
        'Build a scheduled weekly workflow that lists Fathom meetings from the past week, summarizes the key decisions and commitments across calls with an agent, and emails the digest to the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['meeting', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: FathomIcon,
      title: 'Fathom CRM call logger',
      prompt:
        'Build a workflow that triggers when a Fathom meeting ends, pulls the summary and CRM matches, and logs the call notes and next steps to the matched HubSpot contact.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['meeting', 'sales'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: FathomIcon,
      title: 'Fathom action-item tracker',
      prompt:
        'Create a workflow that triggers on a new Fathom meeting, extracts action items from the summary with an agent, and writes each one to a tasks table with owner and due date.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['meeting', 'automation'],
    },
    {
      icon: FathomIcon,
      title: 'Fathom meeting archive',
      prompt:
        'Build a workflow that triggers on a completed Fathom meeting, pulls the full transcript and summary, and saves a formatted recap file to the shared meeting archive.',
      modules: ['files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['meeting', 'note-taking'],
    },
    {
      icon: FathomIcon,
      title: 'Fathom sales-call action items',
      prompt:
        'Create a workflow that after a Fathom meeting pulls the summary and transcript, extracts the customer commitments and next steps with an agent, creates follow-up tasks in the CRM, and emails a recap to the attendees.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'meeting', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
} as const satisfies BlockMeta
