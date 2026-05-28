import { DevinIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

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
  docsLink: 'https://docs.sim.ai/tools/devin',
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
      condition: { field: 'operation', value: 'create_session' },
      mode: 'advanced',
    },
    {
      id: 'sessionId',
      title: 'Session ID',
      type: 'short-input',
      placeholder: 'Enter session ID',
      required: { field: 'operation', value: ['get_session', 'send_message'] },
      condition: { field: 'operation', value: ['get_session', 'send_message'] },
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
      placeholder: 'Number of sessions (1-200, default: 100)',
      condition: { field: 'operation', value: 'list_sessions' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'devin_create_session',
      'devin_get_session',
      'devin_list_sessions',
      'devin_send_message',
    ],
    config: {
      tool: (params) => `devin_${params.operation}`,
      params: (params) => {
        if (params.maxAcuLimit != null && params.maxAcuLimit !== '') {
          params.maxAcuLimit = Number(params.maxAcuLimit)
        }
        if (params.limit != null && params.limit !== '') {
          params.limit = Number(params.limit)
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
    playbookId: { type: 'string', description: 'Playbook ID to guide the session' },
    maxAcuLimit: { type: 'number', description: 'Maximum ACU limit' },
    tags: { type: 'string', description: 'Comma-separated tags' },
    limit: { type: 'number', description: 'Number of sessions to return' },
  },
  outputs: {
    sessionId: { type: 'string', description: 'Session identifier' },
    url: { type: 'string', description: 'URL to view the session in Devin UI' },
    status: {
      type: 'string',
      description: 'Session status (new, claimed, running, exit, error, suspended, resuming)',
    },
    statusDetail: {
      type: 'string',
      description: 'Detailed status (working, waiting_for_user, finished, etc.)',
      condition: { field: 'operation', value: 'list_sessions', not: true },
    },
    title: { type: 'string', description: 'Session title' },
    createdAt: { type: 'number', description: 'Creation timestamp (Unix)' },
    updatedAt: { type: 'number', description: 'Last updated timestamp (Unix)' },
    acusConsumed: {
      type: 'number',
      description: 'ACUs consumed',
      condition: { field: 'operation', value: 'list_sessions', not: true },
    },
    tags: { type: 'json', description: 'Session tags' },
    pullRequests: {
      type: 'json',
      description: 'Pull requests created during the session',
      condition: { field: 'operation', value: 'list_sessions', not: true },
    },
    structuredOutput: {
      type: 'json',
      description: 'Structured output from the session',
      condition: { field: 'operation', value: 'list_sessions', not: true },
    },
    playbookId: {
      type: 'string',
      description: 'Associated playbook ID',
      condition: { field: 'operation', value: 'list_sessions', not: true },
    },
    sessions: {
      type: 'json',
      description: 'List of sessions',
      condition: { field: 'operation', value: 'list_sessions' },
    },
  },
}

export const DevinBlockMeta = {
  tags: ['agentic', 'automation'],
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
} as const satisfies BlockMeta
