import { DevinIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const SESSION_OBJECT_OPERATIONS = [
  'create_session',
  'get_session',
  'send_message',
  'archive_session',
  'terminate_session',
] as const

export const DevinBlock: BlockConfig = {
  type: 'devin',
  name: 'Devin',
  description: 'Autonomous AI software engineer',
  longDescription:
    'Integrate Devin into your workflow. Create sessions to assign coding tasks, send messages to guide active sessions, and retrieve session status and results. Devin autonomously writes, runs, and tests code.',
  bestPractices: `
  - Write clear, specific prompts describing the task, expected outcome, and any constraints.
  - Use playbook IDs to standardize recurring task patterns across sessions.
  - Set ACU limits to control cost for long-running tasks.
  - Use Get Session to poll for completion status before consuming structured output.
  - Send Message auto-resumes suspended sessions — no need to resume separately.
  `,
  docsLink: 'https://docs.sim.ai/integrations/devin',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#12141A',
  icon: DevinIcon,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Session', id: 'create_session' },
        { label: 'Get Session', id: 'get_session' },
        { label: 'List Sessions', id: 'list_sessions' },
        { label: 'Send Message', id: 'send_message' },
        { label: 'List Session Messages', id: 'list_session_messages' },
        { label: 'List Session Attachments', id: 'list_session_attachments' },
        { label: 'Get Session Tags', id: 'get_session_tags' },
        { label: 'Append Session Tags', id: 'append_session_tags' },
        { label: 'Replace Session Tags', id: 'replace_session_tags' },
        { label: 'Archive Session', id: 'archive_session' },
        { label: 'Terminate Session', id: 'terminate_session' },
      ],
      value: () => 'create_session',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Devin API key (cog_...)',
      password: true,
      required: true,
    },
    {
      id: 'orgId',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: 'Enter your Devin organization ID (org-...)',
      required: true,
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Describe the task for Devin...',
      required: { field: 'operation', value: 'create_session' },
      condition: { field: 'operation', value: 'create_session' },
      wandConfig: {
        enabled: true,
        prompt: `You are an expert at writing clear, actionable prompts for Devin, an autonomous AI software engineer. Generate or refine a task prompt based on the user's request.

Current prompt: {context}

RULES:
1. Be specific about the expected outcome and deliverables
2. Include relevant technical context (languages, frameworks, repos)
3. Specify any constraints (don't modify certain files, follow certain patterns)
4. Break complex tasks into clear steps when helpful
5. Return ONLY the prompt text, no markdown formatting or explanations`,
        placeholder: 'Describe what you want Devin to do...',
      },
    },
    {
      id: 'playbookId',
      title: 'Playbook ID',
      type: 'short-input',
      placeholder: 'Optional playbook ID to guide the session',
      condition: { field: 'operation', value: 'create_session' },
      mode: 'advanced',
    },
    {
      id: 'maxAcuLimit',
      title: 'Max ACU Limit',
      type: 'short-input',
      placeholder: 'Maximum ACU budget for this session',
      condition: { field: 'operation', value: 'create_session' },
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tags',
      required: { field: 'operation', value: ['append_session_tags', 'replace_session_tags'] },
      condition: {
        field: 'operation',
        value: ['create_session', 'append_session_tags', 'replace_session_tags'],
      },
    },
    {
      id: 'sessionId',
      title: 'Session ID',
      type: 'short-input',
      placeholder: 'Enter session ID',
      required: { field: 'operation', value: ['create_session', 'list_sessions'], not: true },
      condition: { field: 'operation', value: ['create_session', 'list_sessions'], not: true },
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Enter message to send to Devin...',
      required: { field: 'operation', value: 'send_message' },
      condition: { field: 'operation', value: 'send_message' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (1-200, default: 100)',
      condition: { field: 'operation', value: ['list_sessions', 'list_session_messages'] },
      mode: 'advanced',
    },
    {
      id: 'after',
      title: 'After Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from a previous response',
      condition: { field: 'operation', value: ['list_sessions', 'list_session_messages'] },
      mode: 'advanced',
    },
    {
      id: 'terminateArchive',
      title: 'Archive Instead of Terminate',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'terminate_session' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'devin_create_session',
      'devin_get_session',
      'devin_list_sessions',
      'devin_send_message',
      'devin_list_session_messages',
      'devin_list_session_attachments',
      'devin_get_session_tags',
      'devin_append_session_tags',
      'devin_replace_session_tags',
      'devin_archive_session',
      'devin_terminate_session',
    ],
    config: {
      tool: (params) => `devin_${params.operation}`,
      params: (params) => {
        if (params.maxAcuLimit != null && params.maxAcuLimit !== '') {
          const parsed = Number(params.maxAcuLimit)
          params.maxAcuLimit = Number.isFinite(parsed) ? parsed : undefined
        }
        if (params.limit != null && params.limit !== '') {
          const parsed = Number(params.limit)
          params.limit = Number.isFinite(parsed) ? parsed : undefined
        }
        if (params.terminateArchive != null && params.terminateArchive !== '') {
          params.archive =
            typeof params.terminateArchive === 'boolean'
              ? params.terminateArchive
              : params.terminateArchive === 'true'
        }
        return params
      },
    },
  },
  inputs: {
    prompt: { type: 'string', description: 'Task prompt for Devin' },
    sessionId: { type: 'string', description: 'Session ID' },
    message: { type: 'string', description: 'Message to send to the session' },
    apiKey: { type: 'string', description: 'Devin API key' },
    orgId: { type: 'string', description: 'Devin organization ID' },
    playbookId: { type: 'string', description: 'Playbook ID to guide the session' },
    maxAcuLimit: { type: 'number', description: 'Maximum ACU limit' },
    tags: { type: 'string', description: 'Tags (comma-separated string or array of strings)' },
    limit: { type: 'number', description: 'Maximum number of results to return' },
    after: { type: 'string', description: 'Pagination cursor for the next page' },
    terminateArchive: {
      type: 'string',
      description: 'Whether to archive instead of terminate the session',
    },
  },
  outputs: {
    sessionId: {
      type: 'string',
      description: 'Session identifier',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    url: {
      type: 'string',
      description: 'URL to view the session in Devin UI',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    status: {
      type: 'string',
      description: 'Session status (new, claimed, running, exit, error, suspended, resuming)',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    statusDetail: {
      type: 'string',
      description: 'Detailed status (working, waiting_for_user, finished, etc.)',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    title: {
      type: 'string',
      description: 'Session title',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    createdAt: {
      type: 'number',
      description: 'Creation timestamp (Unix)',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    updatedAt: {
      type: 'number',
      description: 'Last updated timestamp (Unix)',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    acusConsumed: {
      type: 'number',
      description: 'ACUs consumed',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    tags: {
      type: 'json',
      description: 'Session tags (array of strings)',
      condition: {
        field: 'operation',
        value: [
          ...SESSION_OBJECT_OPERATIONS,
          'get_session_tags',
          'append_session_tags',
          'replace_session_tags',
        ],
      },
    },
    pullRequests: {
      type: 'json',
      description: 'Pull requests created during the session ([{pr_url, pr_state}])',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    structuredOutput: {
      type: 'json',
      description: 'Structured output from the session',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    playbookId: {
      type: 'string',
      description: 'Associated playbook ID',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    isArchived: {
      type: 'boolean',
      description: 'Whether the session is archived',
      condition: { field: 'operation', value: [...SESSION_OBJECT_OPERATIONS] },
    },
    sessions: {
      type: 'json',
      description:
        'List of sessions ([{sessionId, url, status, statusDetail, title, tags, acusConsumed, pullRequests, playbookId, isArchived, ...}])',
      condition: { field: 'operation', value: 'list_sessions' },
    },
    messages: {
      type: 'json',
      description: 'Messages in the session ([{eventId, source, message, createdAt}])',
      condition: { field: 'operation', value: 'list_session_messages' },
    },
    attachments: {
      type: 'json',
      description: 'Session attachments ([{attachmentId, name, url, source, contentType}])',
      condition: { field: 'operation', value: 'list_session_attachments' },
    },
    endCursor: {
      type: 'string',
      description: 'Pagination cursor for the next page, or null if last page',
      condition: { field: 'operation', value: ['list_sessions', 'list_session_messages'] },
    },
    hasNextPage: {
      type: 'boolean',
      description: 'Whether more results are available',
      condition: { field: 'operation', value: ['list_sessions', 'list_session_messages'] },
    },
    total: {
      type: 'number',
      description: 'Total number of results, if provided',
      condition: { field: 'operation', value: ['list_sessions', 'list_session_messages'] },
    },
  },
}

export const DevinBlockMeta = {
  tags: ['agentic', 'automation'],
  url: 'https://devin.ai',
  templates: [
    {
      icon: DevinIcon,
      title: 'Devin session launcher',
      prompt:
        'Build a workflow that accepts a coding task description, creates a new Devin session with rich context, polls the session until it produces a pull request or hits a blocker, and posts the session link and status to Slack.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DevinIcon,
      title: 'Devin bug-fix dispatcher',
      prompt:
        'Create a workflow that watches for new critical errors, packages the stack trace and reproduction steps into a Devin prompt, creates a session, and updates a Linear ticket with the Devin session link and any pull requests it opens.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'devops'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: DevinIcon,
      title: 'Devin session monitor',
      prompt:
        'Build a scheduled workflow that runs every ten minutes, lists Devin sessions for your organization, tracks status changes, logs sessions, pull requests, and tags to a table, and sends a Slack alert when any session has been stuck for more than two hours.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring', 'agentic'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DevinIcon,
      title: 'Devin progress nudger',
      prompt:
        'Build a workflow that runs every hour against active Devin sessions, detects sessions that are suspended or awaiting input, sends a targeted follow-up message via the Devin API to unblock progress, and notifies the requester if a session needs human intervention.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DevinIcon,
      title: 'Documentation gap closer',
      prompt:
        'Create a workflow that scans a knowledge base of docs against the latest repo state, finds undocumented public APIs, opens a Devin session for each gap with a prompt to write documentation, and stores the produced markdown back into the knowledge base.',
      modules: ['knowledge-base', 'files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'content', 'agentic'],
    },
    {
      icon: DevinIcon,
      title: 'Devin retrospective report',
      prompt:
        'Build a scheduled weekly workflow that lists Devin sessions completed in the past week, summarizes outcomes, pull requests merged, time-to-completion, and recurring failure modes, and writes a retrospective report file shared with engineering leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'reporting', 'analysis'],
    },
    {
      icon: DevinIcon,
      title: 'Devin issue-to-PR runner',
      prompt:
        'Create a workflow triggered when a Linear issue is labeled ready-for-devin that creates a Devin session with the issue context, monitors the session to completion, and comments the resulting pull request link back on the Linear issue.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation', 'agentic'],
      alsoIntegrations: ['linear'],
    },
  ],
  skills: [
    {
      name: 'start-engineering-session',
      description:
        'Create a Devin session with a clear engineering task prompt and report the session id and link.',
      content:
        '# Start a Devin Engineering Session\n\nKick off an autonomous engineering task with Devin.\n\n## Steps\n1. Confirm the repository and the task to perform.\n2. Write a precise prompt: the goal, constraints, and acceptance criteria.\n3. Create the session, optionally tagging it for tracking.\n4. Capture the session id and URL.\n\n## Output\nA confirmation with the session id, link, and the task prompt Devin was given.',
    },
    {
      name: 'check-session-progress',
      description:
        'Get a Devin session status and recent messages and summarize what it has accomplished or where it is blocked.',
      content:
        '# Check Devin Session Progress\n\nMonitor a running Devin session.\n\n## Steps\n1. Get the session for the given session id and read its status.\n2. List recent session messages to see Devin actions and reasoning.\n3. Determine whether it is making progress, finished, or blocked needing input.\n\n## Output\nA status summary describing progress, current state, and any questions Devin is waiting on.',
    },
    {
      name: 'guide-session',
      description:
        'Send a message to an active Devin session to answer a question or redirect its work.',
      content:
        '# Guide a Devin Session\n\nUnblock or steer an active session.\n\n## Steps\n1. Confirm the session id and review the latest messages.\n2. Compose a clear reply: answer the open question or give new direction.\n3. Send the message to the session.\n4. Confirm Devin has resumed.\n\n## Output\nA confirmation that the message was sent, with the guidance provided.',
    },
  ],
} as const satisfies BlockMeta
