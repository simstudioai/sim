import { GranolaIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const GranolaBlock: BlockConfig = {
  type: 'granola',
  name: 'Granola',
  description: 'Access meeting notes, transcripts, and audit events from Granola',
  longDescription:
    'Integrate Granola into your workflow to retrieve meeting notes, summaries, attendees, and transcripts, review workspace audit events, and manage webhook endpoints. Granola can also trigger workflows when notes are generated, edited, or shared with you.',
  docsLink: 'https://docs.sim.ai/integrations/granola',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#B2C147',
  icon: GranolaIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Granola',
    sentences: {
      byOperation: {
        list_notes: [
          'List meeting notes',
          { text: 'in folder', field: 'folderId' },
          { text: ', created after', field: 'createdAfter' },
          { text: ', before', field: 'createdBefore' },
        ],
        get_note: [{ text: 'Read meeting note', field: 'noteId', core: true }],
        get_transcript: [{ text: 'Read the transcript of note', field: 'noteId', core: true }],
        list_folders: [
          'List note folders',
          { text: ', up to', field: 'pageSize', after: 'per page' },
        ],
        list_audit_events: [
          'List audit events',
          { text: 'for action', field: 'action' },
          { text: ', occurring after', field: 'occurredAfter' },
        ],
        create_webhook_endpoint: [
          'Create a webhook endpoint',
          { text: 'delivering to', field: 'url', core: true },
        ],
        list_webhook_endpoints: ['List webhook endpoints'],
        update_webhook_endpoint: [
          { text: 'Update webhook endpoint', field: 'webhookEndpointId', core: true },
        ],
        delete_webhook_endpoint: [
          { text: 'Delete webhook endpoint', field: 'webhookEndpointId', core: true },
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
        { label: 'List Notes', id: 'list_notes' },
        { label: 'Get Note', id: 'get_note' },
        { label: 'Get Transcript', id: 'get_transcript' },
        { label: 'List Folders', id: 'list_folders' },
        { label: 'List Audit Events', id: 'list_audit_events' },
        { label: 'Create Webhook Endpoint', id: 'create_webhook_endpoint' },
        { label: 'List Webhook Endpoints', id: 'list_webhook_endpoints' },
        { label: 'Update Webhook Endpoint', id: 'update_webhook_endpoint' },
        { label: 'Delete Webhook Endpoint', id: 'delete_webhook_endpoint' },
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
      required: { field: 'operation', value: ['get_note', 'get_transcript'] },
      placeholder: 'e.g., not_1d3tmYTlCICgjy',
      condition: { field: 'operation', value: ['get_note', 'get_transcript'] },
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
      description:
        'Include the transcript inline. If it is too large to return inline, use the Get Transcript operation to page through it instead.',
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
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'e.g., fol_4y6LduVdwSKC27',
      condition: { field: 'operation', value: 'list_notes' },
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '10 (1-30)',
      description:
        'Results per page. Notes, folders, and audit events allow 1-30 (default 10); transcripts allow 1-100 (default 50).',
      condition: {
        field: 'operation',
        value: ['list_notes', 'list_folders', 'list_audit_events', 'get_transcript'],
      },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      condition: {
        field: 'operation',
        value: ['list_notes', 'list_folders', 'list_audit_events', 'get_transcript'],
      },
      mode: 'advanced',
    },
    {
      id: 'action',
      title: 'Action',
      type: 'short-input',
      placeholder: 'e.g., workspace',
      description:
        'Return only events with this exact action, or actions beginning with it followed by a dot ("workspace" matches workspace.member_added but not workspace_automation.created).',
      condition: { field: 'operation', value: 'list_audit_events' },
      mode: 'advanced',
    },
    {
      id: 'occurredAfter',
      title: 'Occurred After',
      type: 'short-input',
      placeholder: 'e.g., 2026-01-01',
      description: 'Must fall within the one-year audit retention window.',
      condition: { field: 'operation', value: 'list_audit_events' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date or datetime string. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'occurredBefore',
      title: 'Occurred Before',
      type: 'short-input',
      placeholder: 'e.g., 2026-03-01',
      description: 'Must fall within the one-year audit retention window.',
      condition: { field: 'operation', value: 'list_audit_events' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date or datetime string. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'url',
      title: 'Delivery URL',
      type: 'short-input',
      required: { field: 'operation', value: 'create_webhook_endpoint' },
      placeholder: 'https://example.com/granola-webhooks',
      description:
        'The publicly reachable HTTPS URL to deliver events to. Private network addresses are rejected. On update, leave blank to keep the current URL.',
      condition: {
        field: 'operation',
        value: ['create_webhook_endpoint', 'update_webhook_endpoint'],
      },
    },
    {
      id: 'scopes',
      title: 'Scopes',
      type: 'short-input',
      required: { field: 'operation', value: 'create_webhook_endpoint' },
      placeholder: 'personal, public',
      description:
        'Comma-separated scopes deciding which notes send events: personal, public. With a Workspace API key pass exactly "workspace". On update, leave blank to keep the current scopes.',
      condition: {
        field: 'operation',
        value: ['create_webhook_endpoint', 'update_webhook_endpoint'],
      },
    },
    {
      id: 'events',
      title: 'Events',
      type: 'short-input',
      placeholder: 'note.generated, note.edited, note.access_granted',
      description:
        'Comma-separated event names to subscribe to. Leave blank to subscribe to all events on create, or to keep the current subscriptions on update.',
      condition: {
        field: 'operation',
        value: ['create_webhook_endpoint', 'update_webhook_endpoint'],
      },
      mode: 'advanced',
    },
    {
      id: 'folderIds',
      title: 'Folder IDs',
      type: 'short-input',
      placeholder: 'fol_2mKr8fQxLp7Ta3, fol_4y6LduVdwSKC27',
      description:
        'Comma-separated folder IDs (max 100) to restrict delivery to. Leave blank for every note matching the scopes; on update, pass [] to clear an existing filter.',
      condition: {
        field: 'operation',
        value: ['create_webhook_endpoint', 'update_webhook_endpoint'],
      },
      mode: 'advanced',
    },
    {
      id: 'webhookEndpointId',
      title: 'Webhook Endpoint ID',
      type: 'short-input',
      required: {
        field: 'operation',
        value: ['update_webhook_endpoint', 'delete_webhook_endpoint'],
      },
      placeholder: 'e.g., whe_2mKr8fQxLp7Ta3',
      condition: {
        field: 'operation',
        value: ['update_webhook_endpoint', 'delete_webhook_endpoint'],
      },
    },
    {
      id: 'enabled',
      title: 'Delivery State',
      type: 'dropdown',
      options: [
        { label: 'Leave unchanged', id: '' },
        { label: 'Enabled', id: 'true' },
        { label: 'Paused', id: 'false' },
      ],
      value: () => '',
      description:
        'Pause or resume deliveries. A paused endpoint keeps its configuration and signing secret, but events that occur while paused are not delivered later.',
      condition: { field: 'operation', value: 'update_webhook_endpoint' },
    },
    ...getTrigger('granola_note_generated').subBlocks,
    ...getTrigger('granola_note_edited').subBlocks,
    ...getTrigger('granola_note_access_granted').subBlocks,
    ...getTrigger('granola_webhook').subBlocks,
  ],

  tools: {
    access: [
      'granola_list_notes',
      'granola_get_note',
      'granola_get_transcript',
      'granola_list_folders',
      'granola_list_audit_events',
      'granola_create_webhook_endpoint',
      'granola_list_webhook_endpoints',
      'granola_update_webhook_endpoint',
      'granola_delete_webhook_endpoint',
    ],
    config: {
      tool: (params) => `granola_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.pageSize) result.pageSize = Number(params.pageSize)
        /* The dropdown is tri-state: '' means "leave unchanged", so only a
           non-empty selection is coerced to the boolean the API expects. */
        if (params.enabled === 'true' || params.enabled === 'false') {
          result.enabled = params.enabled === 'true'
        }
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
    folderId: { type: 'string', description: 'Filter notes by folder ID' },
    pageSize: {
      type: 'number',
      description: 'Results per page (1-30; transcripts allow 1-100)',
    },
    cursor: { type: 'string', description: 'Pagination cursor' },
    action: { type: 'string', description: 'Filter audit events by action prefix' },
    occurredAfter: { type: 'string', description: 'Filter audit events occurring after this date' },
    occurredBefore: {
      type: 'string',
      description: 'Filter audit events occurring before this date',
    },
    url: { type: 'string', description: 'HTTPS delivery URL for a webhook endpoint' },
    scopes: { type: 'string', description: 'Comma-separated webhook endpoint scopes' },
    events: { type: 'string', description: 'Comma-separated webhook event names' },
    folderIds: {
      type: 'string',
      description: 'Comma-separated folder IDs to restrict delivery to',
    },
    webhookEndpointId: { type: 'string', description: 'Webhook endpoint ID' },
    enabled: { type: 'string', description: 'Whether webhook deliveries are active' },
  },

  outputs: {
    notes: {
      type: 'json',
      description: 'List of meeting notes (id, title, ownerName, ownerEmail, createdAt, updatedAt)',
    },
    hasMore: {
      type: 'boolean',
      description:
        'Whether another page is available, for whichever listing ran — notes, folders, audit events, or transcript items',
    },
    cursor: { type: 'string', description: 'Pagination cursor for next page' },
    id: {
      type: 'string',
      description:
        'Note ID for Get Note, or the webhook endpoint ID for the create, update, and delete webhook endpoint operations',
    },
    title: { type: 'string', description: 'Note title' },
    ownerName: { type: 'string', description: 'Note owner name' },
    ownerEmail: { type: 'string', description: 'Note owner email' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    webUrl: { type: 'string', description: 'URL to view the note in Granola' },
    summaryText: { type: 'string', description: 'Plain text meeting summary' },
    summaryMarkdown: { type: 'string', description: 'Markdown meeting summary' },
    attendees: { type: 'json', description: 'Meeting attendees (name, email)' },
    folders: {
      type: 'json',
      description:
        'Folders — a note’s folder memberships (id, name) for Get Note, or the workspace folder listing (id, name, parentFolderId) for List Folders',
    },
    calendarEventTitle: { type: 'string', description: 'Calendar event title' },
    calendarOrganiser: { type: 'string', description: 'Calendar event organiser email' },
    calendarEventId: { type: 'string', description: 'Calendar event ID' },
    scheduledStartTime: { type: 'string', description: 'Scheduled start time' },
    scheduledEndTime: { type: 'string', description: 'Scheduled end time' },
    invitees: { type: 'json', description: 'Calendar event invitee emails' },
    transcript: {
      type: 'json',
      description:
        'Meeting transcript entries (speaker, speakerAttribution, speakerLabel, speakerName, text, startTime, endTime)',
    },
    events: {
      type: 'json',
      description:
        'Audit events (id, action, occurredAt, collectedAt, actorType, actorId, actorEmail, data, ipAddress, userAgent, clientVersion) for List Audit Events, or the subscribed webhook event names for the create and update webhook endpoint operations',
    },
    webhookEndpoints: {
      type: 'json',
      description:
        'Webhook endpoints (id, url, urlRedacted, events, folderIds, scopes, createdByName, createdByEmail, enabled, createdAt)',
    },
    url: { type: 'string', description: 'The HTTPS URL a webhook endpoint delivers to' },
    urlRedacted: {
      type: 'boolean',
      description: 'Whether the returned webhook URL was reduced to its origin',
    },
    folderIds: { type: 'json', description: 'Folder IDs a webhook endpoint is restricted to' },
    scopes: { type: 'json', description: 'Scopes a webhook endpoint receives events for' },
    createdByName: { type: 'string', description: 'Name of the webhook endpoint creator' },
    createdByEmail: { type: 'string', description: 'Email of the webhook endpoint creator' },
    enabled: { type: 'boolean', description: 'Whether webhook deliveries are active' },
    signingSecret: {
      type: 'string',
      description:
        'Signing secret for verifying webhook deliveries. Returned only when creating an endpoint.',
    },
    deleted: { type: 'boolean', description: 'Whether the webhook endpoint was deleted' },
  },

  triggers: {
    enabled: true,
    available: [
      'granola_note_generated',
      'granola_note_edited',
      'granola_note_access_granted',
      'granola_webhook',
    ],
  },
}

export const GranolaBlockMeta = {
  tags: ['meeting', 'note-taking'],
  url: 'https://granola.ai',
  templates: [
    {
      icon: GranolaIcon,
      title: 'Granola meeting brief',
      prompt:
        'Build a scheduled workflow that reads upcoming meetings from Granola notes, researches attendees and topic with Apollo, and posts a prep brief to Slack before each meeting.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['sales', 'research'],
      alsoIntegrations: ['apollo', 'slack'],
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
        'Build a scheduled workflow that polls Granola for new meeting notes, generates a polished meeting-notes page in Notion under the right team space, and links the original Granola note.',
      modules: ['scheduled', 'agent', 'workflows'],
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
  skills: [
    {
      name: 'digest-meeting-notes',
      description:
        'List recent Granola notes and produce a structured digest of takeaways and action items.',
      content:
        '# Digest Meeting Notes\n\nTurn recent Granola meeting notes into a concise digest.\n\n## Steps\n1. List notes, optionally limited to a recent time window.\n2. For each note, get the full note content.\n3. Extract the meeting title, key decisions, takeaways, and action items with owners and due dates if present.\n4. Keep each meeting summary short and uniformly structured.\n\n## Output\nReturn a digest with one section per meeting: title, date, decisions, takeaways, and action items. Suitable for a team recap or daily summary.',
    },
    {
      name: 'extract-action-items',
      description: 'Read a Granola note and pull out a clean list of action items with owners.',
      content:
        '# Extract Action Items\n\nIsolate the follow-ups from a single meeting note.\n\n## Steps\n1. If only a title or date is known, list notes and match to find the note ID.\n2. Get the note content.\n3. Identify every action item, normalizing each into a clear task with an owner and due date when stated.\n4. Drop duplicates and merge near-identical items.\n\n## Output\nReturn a list of action items, each with the task, owner, and due date. Ready to push into a task manager or tracking table.',
    },
    {
      name: 'log-decisions',
      description:
        'Scan Granola notes for decisions made and compile them into a dated decision log.',
      content:
        '# Log Decisions\n\nBuild an auditable record of decisions captured in meetings.\n\n## Steps\n1. List notes across the target window.\n2. Get each note and identify explicit decisions, the rationale, and who made them.\n3. Normalize each into a row with date, decision, owner, and context.\n\n## Output\nReturn a chronological decision log, each entry with date, decision, owner, and supporting context. Useful for writing to a decision-tracking table.',
    },
  ],
} as const satisfies BlockMeta
