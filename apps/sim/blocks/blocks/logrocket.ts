import { LogRocketIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'

/**
 * A highlights request identifies its subject by email or user ID — either one
 * alone is a valid identity, so the card sentence takes whichever is filled.
 * These are mutually exclusive alternates rather than a canonical
 * basic/advanced pair.
 */
const HIGHLIGHTS_IDENTITY_FIELD = ['highlightsUserEmail', 'highlightsUserId'] as const

export const LogRocketBlock: BlockConfig = {
  type: 'logrocket',
  name: 'LogRocket',
  description: 'Summarize sessions, manage users, and tag releases in LogRocket',
  longDescription:
    'Integrate LogRocket into your workflow to request AI session highlights for a user, poll for the result, list exported session files, read the audit log, create or update user profiles, and register releases so source maps decode their stack traces.',
  docsLink: 'https://docs.sim.ai/integrations/logrocket',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#764ABC',
  icon: LogRocketIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'LogRocket',
    sentences: {
      byOperation: {
        request_highlights: [
          { text: 'Summarize sessions for', field: HIGHLIGHTS_IDENTITY_FIELD, core: true },
          { text: 'asking', field: 'question' },
        ],
        get_highlights: [
          { text: 'Get highlights for request', field: 'highlightsRequestId', core: true },
        ],
        list_exported_sessions: [
          'List exported sessions',
          { text: ', up to', field: 'exportLimit', after: 'files' },
        ],
        get_audit_logs: [
          'Read audit logs',
          { text: ', up to', field: 'auditLimit', after: 'entries' },
        ],
        identify_user: [
          { text: 'Update LogRocket profile for', field: 'profileUserId', core: true },
        ],
        create_release: [{ text: 'Register release', field: 'version', core: true }],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Request Highlights', id: 'request_highlights' },
        { label: 'Get Highlights', id: 'get_highlights' },
        { label: 'List Exported Sessions', id: 'list_exported_sessions' },
        { label: 'Get Audit Logs', id: 'get_audit_logs' },
        { label: 'Identify User', id: 'identify_user' },
        { label: 'Create Release', id: 'create_release' },
      ],
      value: () => 'request_highlights',
    },

    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your LogRocket API key',
      password: true,
    },
    {
      id: 'orgId',
      title: 'Organization ID',
      type: 'short-input',
      required: true,
      placeholder: 'Your LogRocket organization ID',
    },
    {
      id: 'appId',
      title: 'Project ID',
      type: 'short-input',
      required: true,
      placeholder: 'Your LogRocket project (app) ID',
    },
    {
      id: 'apiHost',
      title: 'API Host',
      type: 'short-input',
      placeholder: 'https://api.logrocket.com',
      mode: 'advanced',
    },

    // --- Request Highlights fields ---
    {
      id: 'highlightsUserEmail',
      title: 'User Email',
      type: 'short-input',
      placeholder: 'Email of the user (required if no User ID)',
      condition: { field: 'operation', value: 'request_highlights' },
    },
    {
      id: 'highlightsUserId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'User ID (required if no User Email)',
      condition: { field: 'operation', value: 'request_highlights' },
    },
    {
      id: 'question',
      title: 'Question',
      type: 'long-input',
      placeholder: 'e.g., Why did this user fail to complete checkout?',
      condition: { field: 'operation', value: 'request_highlights' },
    },
    {
      id: 'startMs',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'Milliseconds since epoch',
      condition: { field: 'operation', value: 'request_highlights' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in milliseconds since epoch. Return ONLY the number - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endMs',
      title: 'End Time',
      type: 'short-input',
      placeholder: 'Milliseconds since epoch',
      condition: { field: 'operation', value: 'request_highlights' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in milliseconds since epoch. Return ONLY the number - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'webhookURL',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'Notified when the highlights job finishes',
      condition: { field: 'operation', value: 'request_highlights' },
      mode: 'advanced',
    },

    // --- Get Highlights fields ---
    {
      id: 'highlightsRequestId',
      title: 'Request ID',
      type: 'short-input',
      required: { field: 'operation', value: 'get_highlights' },
      placeholder: 'ID returned by Request Highlights',
      condition: { field: 'operation', value: 'get_highlights' },
    },

    // --- List Exported Sessions fields ---
    {
      id: 'exportLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Default 10, maximum 100',
      condition: { field: 'operation', value: 'list_exported_sessions' },
      mode: 'advanced',
    },
    {
      id: 'exportCursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous page',
      condition: { field: 'operation', value: 'list_exported_sessions' },
      mode: 'advanced',
    },
    {
      id: 'exportDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'Milliseconds since epoch',
      condition: { field: 'operation', value: 'list_exported_sessions' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in milliseconds since epoch. Return ONLY the number - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },

    // --- Get Audit Logs fields ---
    {
      id: 'auditLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Number of audit log records to return',
      condition: { field: 'operation', value: 'get_audit_logs' },
      mode: 'advanced',
    },
    {
      id: 'auditCursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous page',
      condition: { field: 'operation', value: 'get_audit_logs' },
      mode: 'advanced',
    },

    // --- Identify User fields ---
    {
      id: 'profileUserId',
      title: 'User ID',
      type: 'short-input',
      required: { field: 'operation', value: 'identify_user' },
      placeholder: 'ID of the user to create or update',
      condition: { field: 'operation', value: 'identify_user' },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Display name (max 1024 characters)',
      condition: { field: 'operation', value: 'identify_user' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email address (max 1024 characters)',
      condition: { field: 'operation', value: 'identify_user' },
    },
    {
      id: 'traits',
      title: 'Traits',
      type: 'long-input',
      placeholder: '{"plan": "free", "favoriteColor": "blue"}',
      condition: { field: 'operation', value: 'identify_user' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of custom user traits for LogRocket. Keys and values are limited to 1024 characters. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'timestamp',
      title: 'Timestamp',
      type: 'short-input',
      placeholder: 'Milliseconds since epoch',
      condition: { field: 'operation', value: 'identify_user' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a timestamp in milliseconds since epoch. Return ONLY the number - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },

    // --- Create Release fields ---
    {
      id: 'version',
      title: 'Version',
      type: 'short-input',
      required: { field: 'operation', value: 'create_release' },
      placeholder: 'e.g., 1.2.3 or a commit SHA',
      condition: { field: 'operation', value: 'create_release' },
    },
  ],

  tools: {
    access: [
      'logrocket_request_highlights',
      'logrocket_get_highlights',
      'logrocket_list_exported_sessions',
      'logrocket_get_audit_logs',
      'logrocket_identify_user',
      'logrocket_create_release',
    ],
    config: {
      tool: (params) => `logrocket_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}

        switch (params.operation) {
          case 'request_highlights':
            if (params.highlightsUserEmail) result.userEmail = params.highlightsUserEmail
            if (params.highlightsUserId) result.userID = params.highlightsUserId
            break

          case 'get_highlights':
            if (params.highlightsRequestId) result.id = params.highlightsRequestId
            break

          case 'list_exported_sessions':
            if (params.exportLimit) result.limit = params.exportLimit
            if (params.exportCursor) result.cursor = params.exportCursor
            if (params.exportDate) result.date = params.exportDate
            break

          case 'get_audit_logs':
            if (params.auditLimit) result.limit = params.auditLimit
            if (params.auditCursor) result.cursor = params.auditCursor
            break

          case 'identify_user':
            if (params.profileUserId) result.userId = params.profileUserId
            break
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'LogRocket API key' },
    orgId: { type: 'string', description: 'LogRocket organization ID' },
    appId: { type: 'string', description: 'LogRocket project (app) ID' },
    apiHost: { type: 'string', description: 'API host override for Private Cloud deployments' },
    highlightsUserEmail: { type: 'string', description: 'Email of the user to summarize' },
    highlightsUserId: { type: 'string', description: 'ID of the user to summarize' },
    question: { type: 'string', description: 'Question to focus the highlights on' },
    startMs: { type: 'string', description: 'Session window start, in milliseconds since epoch' },
    endMs: { type: 'string', description: 'Session window end, in milliseconds since epoch' },
    webhookURL: { type: 'string', description: 'URL notified when the highlights job finishes' },
    highlightsRequestId: { type: 'string', description: 'ID of a highlights request to retrieve' },
    exportLimit: { type: 'string', description: 'Exported sessions per page' },
    exportCursor: { type: 'string', description: 'Exported sessions pagination cursor' },
    exportDate: { type: 'string', description: 'Exported sessions start timestamp' },
    auditLimit: { type: 'string', description: 'Audit log records per page' },
    auditCursor: { type: 'string', description: 'Audit log pagination cursor' },
    profileUserId: { type: 'string', description: 'ID of the user to create or update' },
    name: { type: 'string', description: 'Display name of the user' },
    email: { type: 'string', description: 'Email of the user' },
    traits: { type: 'string', description: 'Custom user traits JSON object' },
    timestamp: {
      type: 'string',
      description: 'Profile data timestamp in milliseconds since epoch',
    },
    version: { type: 'string', description: 'Release version to register' },
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Highlights request ID (request_highlights)',
    },
    status: {
      type: 'string',
      description: 'Highlights job status: PENDING, READY, or FAILED (get_highlights)',
    },
    requestID: {
      type: 'string',
      description: 'ID of the highlights request (get_highlights)',
    },
    appID: {
      type: 'string',
      description: 'LogRocket project the request belongs to (get_highlights)',
    },
    highlights: {
      type: 'string',
      description: 'Markdown summary across the matched sessions (get_highlights)',
    },
    sessions: {
      type: 'json',
      description:
        'Per-session highlights (recordingID, sessionID, highlights) for get_highlights, or exported file URLs for list_exported_sessions',
    },
    logs: {
      type: 'json',
      description:
        'Audit log entries (time, createdDate, user, action, description) (get_audit_logs)',
    },
    cursor: {
      type: 'string',
      description: 'Opaque cursor for the next page (list_exported_sessions, get_audit_logs)',
    },
    hasNext: {
      type: 'boolean',
      description: 'Whether more audit logs exist beyond this page (get_audit_logs)',
    },
    userID: {
      type: 'string',
      description: 'ID of the created or updated user (identify_user)',
    },
    name: {
      type: 'string',
      description: 'Display name stored on the profile (identify_user)',
    },
    email: {
      type: 'string',
      description: 'Email stored on the profile (identify_user)',
    },
    traits: {
      type: 'json',
      description: 'Custom traits stored on the profile, values coerced to strings (identify_user)',
    },
    version: {
      type: 'string',
      description: 'Release version that was registered (create_release)',
    },
  },
}

export const LogRocketBlockMeta = {
  tags: ['monitoring', 'error-tracking', 'data-analytics'],
  url: 'https://logrocket.com',
  templates: [
    {
      icon: LogRocketIcon,
      title: 'LogRocket session triage from support tickets',
      prompt:
        'Build a workflow that triggers on a new Zendesk ticket, requests LogRocket session highlights for the reporting user, polls until the result is ready, and posts the session summary back onto the ticket as an internal note.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: LogRocketIcon,
      title: 'LogRocket churn-risk session review',
      prompt:
        'Create a scheduled workflow that reads at-risk accounts from a table, requests LogRocket session highlights for each contact, and writes the summarized friction points back to the table for the customer success team.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting'],
    },
    {
      icon: LogRocketIcon,
      title: 'LogRocket bug report enrichment',
      prompt:
        'Build a workflow that triggers on a new Linear bug issue, asks LogRocket for session highlights of the affected user with the bug description as the question, and comments the session breakdown on the issue.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['debugging', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: LogRocketIcon,
      title: 'LogRocket audit log compliance export',
      prompt:
        'Create a scheduled workflow that pages through the LogRocket audit log every night, writes each entry to a compliance table, and alerts Slack when a session was viewed by someone outside the approved reviewer list.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['compliance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: LogRocketIcon,
      title: 'LogRocket session export pipeline',
      prompt:
        'Build a scheduled workflow that lists newly exported LogRocket session files, downloads each JSON Lines export, and loads the parsed events into a warehouse table for analysis.',
      modules: ['tables', 'scheduled', 'workflows'],
      category: 'operations',
      tags: ['sync', 'data-pipeline'],
    },
    {
      icon: LogRocketIcon,
      title: 'LogRocket profile sync from CRM',
      prompt:
        'Create a workflow that watches HubSpot contact updates and pushes the plan, lifecycle stage, and account value into LogRocket as user traits so sessions can be filtered by customer segment.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['sync', 'automation'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: LogRocketIcon,
      title: 'LogRocket + Sentry incident context',
      prompt:
        'Build a workflow that triggers on a new Sentry issue, requests LogRocket session highlights for the impacted user, and posts a combined stack trace plus session narrative into the incident Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['debugging', 'monitoring'],
      alsoIntegrations: ['sentry', 'slack'],
    },
    {
      icon: LogRocketIcon,
      title: 'LogRocket release tagging on deploy',
      prompt:
        'Build a workflow that runs after a GitHub deployment succeeds, registers the deployed version as a LogRocket release so stack traces decode against it, and posts the tagged version to the release channel in Slack.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'ci-cd'],
      alsoIntegrations: ['github', 'slack'],
    },
  ],
  skills: [
    {
      name: 'summarize-user-sessions',
      description:
        'Request LogRocket session highlights for a user, wait for the job to finish, and report what happened in their sessions.',
      content:
        '# Summarize User Sessions\n\nUse LogRocket to explain what a specific user did and where they got stuck.\n\n## Steps\n1. Identify the user by email or user ID.\n2. Optionally narrow to a time window and supply a focused question, e.g. why checkout failed.\n3. Request session highlights and keep the returned request ID.\n4. Poll for the result until the status is READY. It typically takes one to three minutes. A FAILED status means the request should be retried.\n\n## Output\nThe overall highlights summary plus the per-session breakdown, each with its recording ID. Note the time window covered.',
    },
    {
      name: 'investigate-reported-bug',
      description:
        'Pull LogRocket session highlights for the user who reported a bug and turn them into reproduction steps.',
      content:
        '# Investigate Reported Bug\n\nTurn a vague bug report into concrete reproduction steps using LogRocket sessions.\n\n## Steps\n1. Extract the reporting user email or ID and the time the problem occurred.\n2. Request session highlights for that user, scoped to a window around the report, using the bug description as the question.\n3. Wait for the result and read the per-session highlights.\n4. Map the described actions into ordered reproduction steps and note the failing step.\n\n## Output\nReproduction steps, the observed failure, and links to the relevant recording IDs.',
    },
    {
      name: 'sync-user-traits',
      description:
        'Create or update a LogRocket user profile with name, email, and custom traits so sessions can be segmented.',
      content:
        '# Sync User Traits\n\nKeep LogRocket user profiles current so sessions can be filtered by customer attributes.\n\n## Steps\n1. Determine the user ID to write to. This is the identifier LogRocket already associates with the sessions.\n2. Gather the traits to set, such as plan, lifecycle stage, or account value. Keep every key and value under 1024 characters.\n3. Optionally supply a timestamp describing when the data was true.\n4. Write the profile.\n\n## Output\nConfirm which fields were written and note that every trait value is stored as a string.',
    },
    {
      name: 'review-session-access',
      description:
        'Page through the LogRocket audit log to report who viewed sessions and what actions they took.',
      content:
        '# Review Session Access\n\nAudit who has been viewing LogRocket sessions.\n\n## Steps\n1. Read the first page of audit logs, choosing a page size.\n2. While the response reports more pages, follow the returned cursor to fetch the next page.\n3. Group entries by actor and action to see who viewed what.\n\n## Output\nA per-actor summary of actions with timestamps, plus any access that looks unexpected.',
    },
    {
      name: 'collect-exported-sessions',
      description:
        'List LogRocket data export files and collect their download URLs for downstream processing.',
      content:
        '# Collect Exported Sessions\n\nGather the session export files LogRocket has produced.\n\n## Steps\n1. List exported sessions, optionally starting from a timestamp and choosing a page size of up to 100.\n2. Note that results come back oldest first, and follow the returned cursor to page forward.\n3. Collect the download URL for each export file. Each file is JSON Lines.\n\n## Output\nThe list of export URLs, the range they cover, and the cursor to resume from next run.',
    },
  ],
} as const satisfies BlockMeta
