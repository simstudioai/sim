import { MintlifyIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

/**
 * SubBlock IDs each operation may forward to its tool. Anything outside the
 * selected operation's list is explicitly cleared, because the executor merges
 * `tools.config.params` on top of the raw inputs and a retained advanced-mode
 * value would otherwise leak across operations.
 */
const OPERATION_PARAMS: Record<string, readonly string[]> = {
  trigger_update: ['projectId'],
  get_update_status: ['statusId'],
  trigger_preview: ['projectId', 'branch'],
  trigger_automation: ['projectId', 'automationId'],
  detect_ai_prose: ['projectId', 'deslopPath', 'content'],
  create_agent_job: ['projectId', 'prompt'],
  get_agent_job: ['projectId', 'jobId'],
  send_agent_message: ['projectId', 'jobId', 'prompt'],
  search: ['domain', 'query', 'pageSize', 'scoreThreshold', 'version', 'language', 'tag', 'groups'],
  get_page_content: ['domain', 'pagePath', 'groups'],
  create_assistant_message: [
    'domain',
    'message',
    'messages',
    'fp',
    'threadId',
    'retrievalPageSize',
    'currentPath',
    'version',
    'language',
    'groups',
    'assistantContext',
  ],
  get_feedback: [
    'projectId',
    'dateFrom',
    'dateTo',
    'feedbackSource',
    'feedbackStatus',
    'limit',
    'cursor',
  ],
  get_feedback_by_page: [
    'projectId',
    'dateFrom',
    'dateTo',
    'limit',
    'feedbackSource',
    'feedbackStatus',
  ],
  get_assistant_conversations: ['projectId', 'dateFrom', 'dateTo', 'limit', 'cursor'],
  get_assistant_caller_stats: ['projectId', 'dateFrom', 'dateTo'],
  get_searches: ['projectId', 'dateFrom', 'dateTo', 'limit', 'cursor'],
  get_views: ['projectId', 'dateFrom', 'dateTo', 'limit', 'offset'],
  get_visitors: ['projectId', 'dateFrom', 'dateTo', 'limit', 'offset'],
}

/** SubBlock IDs whose value reaches the tool under a different param name. */
const PARAM_ALIASES: Record<string, string> = {
  deslopPath: 'path',
  pagePath: 'path',
  feedbackSource: 'source',
  feedbackStatus: 'status',
}

const NUMERIC_PARAMS = new Set([
  'pageSize',
  'scoreThreshold',
  'retrievalPageSize',
  'limit',
  'offset',
])

const PROJECT_OPERATIONS = [
  'trigger_update',
  'trigger_preview',
  'trigger_automation',
  'detect_ai_prose',
  'create_agent_job',
  'get_agent_job',
  'send_agent_message',
  'get_feedback',
  'get_feedback_by_page',
  'get_assistant_conversations',
  'get_assistant_caller_stats',
  'get_searches',
  'get_views',
  'get_visitors',
]

const ANALYTICS_OPERATIONS = [
  'get_feedback',
  'get_feedback_by_page',
  'get_assistant_conversations',
  'get_assistant_caller_stats',
  'get_searches',
  'get_views',
  'get_visitors',
]

const LIMIT_OPERATIONS = [
  'get_feedback',
  'get_feedback_by_page',
  'get_assistant_conversations',
  'get_searches',
  'get_views',
  'get_visitors',
]

const CURSOR_OPERATIONS = ['get_feedback', 'get_assistant_conversations', 'get_searches']

const FEEDBACK_OPERATIONS = ['get_feedback', 'get_feedback_by_page']

const DOMAIN_OPERATIONS = ['search', 'get_page_content', 'create_assistant_message']

const RETRIEVAL_FILTER_OPERATIONS = ['search', 'create_assistant_message']

export const MintlifyBlock: BlockConfig = {
  type: 'mintlify',
  name: 'Mintlify',
  description: 'Deploy, edit, search, and measure Mintlify documentation',
  longDescription:
    'Integrate Mintlify into your workflow. Trigger production and preview deployments, run scheduled automations, launch documentation agent jobs, detect AI-sounding prose, search your docs and read page content, ask the docs assistant, and export feedback, conversation, search, view, and visitor analytics.',
  docsLink: 'https://docs.sim.ai/integrations/mintlify',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#000000',
  icon: MintlifyIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Mintlify',
    sentences: {
      byOperation: {
        trigger_update: [{ text: 'Deploy project', field: 'projectId', core: true }],
        get_update_status: [{ text: 'Check deployment', field: 'statusId', core: true }],
        trigger_preview: [{ text: 'Deploy branch', field: 'branch', core: true }, 'as a preview'],
        trigger_automation: [{ text: 'Run automation', field: 'automationId', core: true }],
        create_agent_job: [{ text: 'Ask the docs agent to', field: 'prompt', core: true }],
        get_agent_job: [{ text: 'Check agent job', field: 'jobId', core: true }],
        send_agent_message: [
          { text: 'Send', field: 'prompt', core: true },
          { text: 'to agent job', field: 'jobId', core: true },
        ],
        detect_ai_prose: [
          { text: 'Check page', field: 'deslopPath', core: true },
          'for AI-sounding prose',
        ],
        search: [
          { text: 'Search the docs at', field: 'domain', core: true },
          { text: 'for', field: 'query', core: true },
          { text: ', tagged', field: 'tag' },
        ],
        get_page_content: [
          { text: 'Read page', field: 'pagePath', core: true },
          { text: 'from', field: 'domain', core: true },
        ],
        create_assistant_message: [
          { text: 'Ask the docs assistant', field: 'message', core: true },
        ],
        get_feedback: ['List documentation feedback', { text: ', since', field: 'dateFrom' }],
        get_feedback_by_page: [
          'List documentation feedback by page',
          { text: ', since', field: 'dateFrom' },
        ],
        get_assistant_conversations: [
          'List assistant conversations',
          { text: ', since', field: 'dateFrom' },
        ],
        get_assistant_caller_stats: [
          'Report assistant usage by caller',
          { text: ', since', field: 'dateFrom' },
        ],
        get_searches: ['List search queries', { text: ', since', field: 'dateFrom' }],
        get_views: ['Report page views', { text: ', since', field: 'dateFrom' }],
        get_visitors: ['Report unique visitors', { text: ', since', field: 'dateFrom' }],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Trigger Update', id: 'trigger_update' },
        { label: 'Get Update Status', id: 'get_update_status' },
        { label: 'Trigger Preview Deployment', id: 'trigger_preview' },
        { label: 'Trigger Automation', id: 'trigger_automation' },
        { label: 'Create Agent Job', id: 'create_agent_job' },
        { label: 'Get Agent Job', id: 'get_agent_job' },
        { label: 'Send Agent Message', id: 'send_agent_message' },
        { label: 'Detect AI-Sounding Prose', id: 'detect_ai_prose' },
        { label: 'Search Documentation', id: 'search' },
        { label: 'Get Page Content', id: 'get_page_content' },
        { label: 'Ask Assistant', id: 'create_assistant_message' },
        { label: 'Get Feedback', id: 'get_feedback' },
        { label: 'Get Feedback By Page', id: 'get_feedback_by_page' },
        { label: 'Get Assistant Conversations', id: 'get_assistant_conversations' },
        { label: 'Get Assistant Caller Stats', id: 'get_assistant_caller_stats' },
        { label: 'Get Search Queries', id: 'get_searches' },
        { label: 'Get Page Views', id: 'get_views' },
        { label: 'Get Unique Visitors', id: 'get_visitors' },
      ],
      value: () => 'trigger_update',
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Copy from the API keys page in your dashboard',
      condition: { field: 'operation', value: PROJECT_OPERATIONS },
      required: { field: 'operation', value: PROJECT_OPERATIONS },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Identifier from your domain.mintlify.site URL',
      condition: { field: 'operation', value: DOMAIN_OPERATIONS },
      required: { field: 'operation', value: DOMAIN_OPERATIONS },
    },
    {
      id: 'statusId',
      title: 'Status ID',
      type: 'short-input',
      placeholder: 'Status ID returned by a deployment trigger',
      condition: { field: 'operation', value: 'get_update_status' },
      required: { field: 'operation', value: 'get_update_status' },
    },
    {
      id: 'branch',
      title: 'Branch',
      type: 'short-input',
      placeholder: 'feature/new-guides',
      condition: { field: 'operation', value: 'trigger_preview' },
      required: { field: 'operation', value: 'trigger_preview' },
    },
    {
      id: 'automationId',
      title: 'Automation ID',
      type: 'short-input',
      placeholder: "Copy from the automation's settings panel",
      condition: { field: 'operation', value: 'trigger_automation' },
      required: { field: 'operation', value: 'trigger_automation' },
    },
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      placeholder: 'Agent job ID',
      condition: { field: 'operation', value: ['get_agent_job', 'send_agent_message'] },
      required: { field: 'operation', value: ['get_agent_job', 'send_agent_message'] },
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'Add a quickstart guide for the Python SDK',
      condition: { field: 'operation', value: ['create_agent_job', 'send_agent_message'] },
      required: { field: 'operation', value: ['create_agent_job', 'send_agent_message'] },
    },
    {
      id: 'deslopPath',
      title: 'Page Path',
      type: 'short-input',
      placeholder: 'guides/quickstart.mdx',
      condition: { field: 'operation', value: 'detect_ai_prose' },
      required: { field: 'operation', value: 'detect_ai_prose' },
    },
    {
      id: 'content',
      title: 'Page Content',
      type: 'long-input',
      placeholder: 'Raw MDX or Markdown content of the page',
      condition: { field: 'operation', value: 'detect_ai_prose' },
      required: { field: 'operation', value: 'detect_ai_prose' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'How do I configure custom domains?',
      condition: { field: 'operation', value: 'search' },
      required: { field: 'operation', value: 'search' },
    },
    {
      id: 'pagePath',
      title: 'Page Path',
      type: 'short-input',
      placeholder: 'Path returned by Search Documentation',
      condition: { field: 'operation', value: 'get_page_content' },
      required: { field: 'operation', value: 'get_page_content' },
    },
    {
      id: 'message',
      title: 'Question',
      type: 'long-input',
      placeholder: 'How do I get started?',
      condition: { field: 'operation', value: 'create_assistant_message' },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'scoreThreshold',
      title: 'Score Threshold',
      type: 'short-input',
      placeholder: '0.5',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'tag',
      title: 'Tag Filter',
      type: 'short-input',
      placeholder: 'api-reference',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'version',
      title: 'Version Filter',
      type: 'short-input',
      placeholder: 'v2',
      condition: { field: 'operation', value: RETRIEVAL_FILTER_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Language Filter',
      type: 'short-input',
      placeholder: 'en',
      condition: { field: 'operation', value: RETRIEVAL_FILTER_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'groups',
      title: 'Authorized Groups',
      type: 'long-input',
      placeholder: '["customers", "internal"]',
      condition: { field: 'operation', value: DOMAIN_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Mintlify documentation group identifiers the caller is authorized to access.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON array of strings, starting with [ and ending with ]
- Each entry is a group identifier configured on the deployment's auth or userAuth setup

### EXAMPLE
User: "customers and internal staff"
Output:
["customers", "internal"]

Return ONLY the JSON array.`,
        placeholder: 'Describe the authorized groups...',
        generationType: 'json-object',
      },
    },
    {
      id: 'messages',
      title: 'Messages',
      type: 'long-input',
      placeholder: '[{"id": "1", "role": "user", "parts": [{"type": "text", "text": "Hello"}]}]',
      condition: { field: 'operation', value: 'create_assistant_message' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of AI SDK messages for the Mintlify assistant.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON array starting with [ and ending with ]
- Each message has "id" (unique string), "role" ("user", "assistant", or "system"), and "parts"
- Each part is an object with "type": "text" and a "text" string

### EXAMPLE
User: "A user asking about pricing, then a follow-up about enterprise plans"
Output:
[{"id": "1", "role": "user", "parts": [{"type": "text", "text": "What does it cost?"}]}, {"id": "2", "role": "user", "parts": [{"type": "text", "text": "What about enterprise plans?"}]}]

Return ONLY the JSON array.`,
        placeholder: 'Describe the conversation...',
        generationType: 'json-object',
      },
    },
    {
      id: 'threadId',
      title: 'Thread ID',
      type: 'short-input',
      placeholder: 'Thread ID from a previous assistant response',
      condition: { field: 'operation', value: 'create_assistant_message' },
      mode: 'advanced',
    },
    {
      id: 'fp',
      title: 'Fingerprint',
      type: 'short-input',
      placeholder: 'anonymous',
      condition: { field: 'operation', value: 'create_assistant_message' },
      mode: 'advanced',
    },
    {
      id: 'retrievalPageSize',
      title: 'Retrieval Page Size',
      type: 'short-input',
      placeholder: '5',
      condition: { field: 'operation', value: 'create_assistant_message' },
      mode: 'advanced',
    },
    {
      id: 'currentPath',
      title: 'Current Path',
      type: 'short-input',
      placeholder: 'guides/quickstart',
      condition: { field: 'operation', value: 'create_assistant_message' },
      mode: 'advanced',
    },
    {
      id: 'assistantContext',
      title: 'Context',
      type: 'long-input',
      placeholder: '[{"type": "code", "value": "const x = 1", "elementId": "code-block-1"}]',
      condition: { field: 'operation', value: 'create_assistant_message' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Mintlify assistant context objects.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON array starting with [ and ending with ]
- Each object requires "type" ("code" or "textSelection") and "value" (the snippet or selected text)
- Optionally include "path" (source file or page) and "elementId" (UI element identifier)

### EXAMPLE
User: "A code snippet from the quickstart page"
Output:
[{"type": "code", "value": "npm install mintlify", "path": "guides/quickstart", "elementId": "code-block-1"}]

Return ONLY the JSON array.`,
        placeholder: 'Describe the context to provide...',
        generationType: 'json-object',
      },
    },
    {
      id: 'dateFrom',
      title: 'Date From',
      type: 'short-input',
      placeholder: '2026-01-01',
      condition: { field: 'operation', value: ANALYTICS_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an inclusive start date in YYYY-MM-DD format for a Mintlify analytics export. Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'dateTo',
      title: 'Date To',
      type: 'short-input',
      placeholder: '2026-02-01',
      condition: { field: 'operation', value: ANALYTICS_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an exclusive end date in YYYY-MM-DD format for a Mintlify analytics export. Results include dates before, but not on, this date. Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'feedbackSource',
      title: 'Feedback Source',
      type: 'dropdown',
      options: [
        { label: 'All Sources', id: '' },
        { label: 'Contextual', id: 'contextual' },
        { label: 'Code Snippet', id: 'code_snippet' },
        { label: 'Agent', id: 'agent' },
        { label: 'Thumbs Only', id: 'thumbs_only' },
      ],
      value: () => '',
      condition: { field: 'operation', value: FEEDBACK_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'feedbackStatus',
      title: 'Feedback Status',
      type: 'short-input',
      placeholder: 'pending,in_progress',
      condition: { field: 'operation', value: FEEDBACK_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50',
      condition: { field: 'operation', value: LIMIT_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous response',
      condition: { field: 'operation', value: CURSOR_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: ['get_views', 'get_visitors'] },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Admin key (mint_) — assistant key (mint_dsc_) for docs search and assistant',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'mintlify_trigger_update',
      'mintlify_get_update_status',
      'mintlify_trigger_preview',
      'mintlify_trigger_automation',
      'mintlify_detect_ai_prose',
      'mintlify_create_agent_job',
      'mintlify_get_agent_job',
      'mintlify_send_agent_message',
      'mintlify_search',
      'mintlify_get_page_content',
      'mintlify_create_assistant_message',
      'mintlify_get_feedback',
      'mintlify_get_feedback_by_page',
      'mintlify_get_assistant_conversations',
      'mintlify_get_assistant_caller_stats',
      'mintlify_get_searches',
      'mintlify_get_views',
      'mintlify_get_visitors',
    ],
    config: {
      tool: (params: Record<string, unknown>) => `mintlify_${params.operation}`,
      params: (params: Record<string, unknown>) => {
        const { operation } = params
        // On the agent-tool path `operation` is a sibling of the tool call rather
        // than a member of params, so clearing anything here would erase the
        // model's own arguments.
        if (typeof operation !== 'string') return {}

        const allowed = OPERATION_PARAMS[operation]
        if (!allowed) return {}

        const result: Record<string, unknown> = {}
        for (const key of Object.keys(params)) {
          if (key === 'operation' || key === 'apiKey') continue
          result[key] = undefined
        }

        for (const key of allowed) {
          const value = params[key]
          if (value === undefined || value === null || value === '') continue

          if (NUMERIC_PARAMS.has(key)) {
            const numeric = Number(value)
            if (!Number.isFinite(numeric)) continue
            result[key] = numeric
            continue
          }

          result[PARAM_ALIASES[key] ?? key] = value
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    projectId: { type: 'string', description: 'Mintlify project ID' },
    domain: { type: 'string', description: 'Deployment domain identifier' },
    statusId: { type: 'string', description: 'Deployment status ID' },
    branch: { type: 'string', description: 'Git branch to preview' },
    automationId: { type: 'string', description: 'Scheduled automation ID' },
    jobId: { type: 'string', description: 'Agent job ID' },
    prompt: { type: 'string', description: 'Instruction for the documentation agent' },
    deslopPath: { type: 'string', description: 'Repo-relative path of the page to analyze' },
    content: { type: 'string', description: 'Raw MDX or Markdown content of the page' },
    query: { type: 'string', description: 'Documentation search query' },
    pagePath: { type: 'string', description: 'Page slug or path to retrieve' },
    message: { type: 'string', description: 'Question to ask the docs assistant' },
    messages: { type: 'json', description: 'Full AI SDK message array for multi-turn chats' },
    threadId: { type: 'string', description: 'Assistant thread ID to continue' },
    fp: { type: 'string', description: 'Fingerprint identifier for the assistant session' },
    retrievalPageSize: {
      type: 'string',
      description: 'Number of search results used to generate the assistant response',
    },
    currentPath: { type: 'string', description: 'Path of the page the user is viewing' },
    assistantContext: { type: 'json', description: 'Contextual snippets for the assistant' },
    pageSize: { type: 'string', description: 'Number of search results to return' },
    scoreThreshold: { type: 'string', description: 'Minimum relevance score for search results' },
    version: { type: 'string', description: 'Documentation version filter' },
    language: { type: 'string', description: 'Content language filter' },
    tag: { type: 'string', description: 'Tag filter for search results' },
    groups: { type: 'json', description: 'Authorized documentation groups' },
    dateFrom: { type: 'string', description: 'Inclusive analytics start date' },
    dateTo: { type: 'string', description: 'Exclusive analytics end date' },
    feedbackSource: { type: 'string', description: 'Feedback source filter' },
    feedbackStatus: { type: 'string', description: 'Comma-separated feedback status filter' },
    limit: { type: 'string', description: 'Max results per page' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    offset: { type: 'string', description: 'Number of rows to skip' },
    apiKey: { type: 'string', description: 'Mintlify API key' },
  },

  outputs: {
    statusId: { type: 'string', description: 'Status ID of a queued deployment' },
    previewUrl: { type: 'string', description: 'URL where the preview deployment is hosted' },
    id: { type: 'string', description: 'Deployment status ID or agent job ID' },
    projectId: { type: 'string', description: 'Documentation project ID' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    endedAt: { type: 'string', description: 'Deployment end timestamp' },
    archivedAt: { type: 'string', description: 'Agent job archive timestamp' },
    status: { type: 'string', description: 'Deployment status or agent job status' },
    summary: { type: 'string', description: 'Summary of the deployment status' },
    logs: { type: 'array', description: 'Deployment log lines' },
    subdomain: { type: 'string', description: 'Subdomain of the docs being updated' },
    screenshot: { type: 'string', description: 'Screenshot of the docs' },
    screenshotLight: { type: 'string', description: 'Light-mode screenshot of the docs' },
    screenshotDark: { type: 'string', description: 'Dark-mode screenshot of the docs' },
    author: { type: 'json', description: 'Author of the deployment update' },
    commit: { type: 'json', description: 'Commit that produced the deployment' },
    source: {
      type: 'json',
      description:
        'Deployment trigger source (string) or agent job source repository details (object)',
    },
    schemaId: { type: 'string', description: 'ID of the triggered automation' },
    instanceId: { type: 'string', description: 'ID of the queued automation run' },
    jobId: { type: 'string', description: 'ID of the background job processing an automation run' },
    model: { type: 'string', description: 'AI model used for the agent job' },
    prLink: { type: 'string', description: 'Pull request URL created by the agent' },
    path: { type: 'string', description: 'Documentation page path' },
    content: { type: 'string', description: 'Full text content of the page' },
    skipped: { type: 'string', description: 'Reason a prose check was skipped' },
    predictionShort: {
      type: 'string',
      description: 'Prose verdict: AI, AI-Assisted, Human, Mixed',
    },
    fractionAi: { type: 'number', description: 'Fraction of the page detected as AI-generated' },
    fractionAiAssisted: { type: 'number', description: 'Fraction detected as AI-assisted' },
    fractionHuman: { type: 'number', description: 'Fraction detected as human-written' },
    windows: { type: 'array', description: 'Flagged passages with suggested rewrites' },
    creditsCharged: { type: 'number', description: 'AI credits charged for the prose check' },
    results: { type: 'array', description: 'Documentation search results' },
    resultCount: { type: 'number', description: 'Number of search results returned' },
    text: { type: 'string', description: 'Assembled assistant answer' },
    threadId: { type: 'string', description: 'Assistant thread ID for follow-up messages' },
    sources: { type: 'array', description: 'Documentation sources the assistant cited' },
    feedback: { type: 'array', description: 'Feedback entries or per-page feedback aggregates' },
    conversations: { type: 'array', description: 'Assistant conversation history' },
    searches: { type: 'array', description: 'Documentation search terms with hit counts' },
    totalSearches: { type: 'number', description: 'Total search events in the date range' },
    views: { type: 'array', description: 'Per-page content view event counts' },
    visitors: { type: 'array', description: 'Per-page unique visitor counts' },
    totals: { type: 'json', description: 'Site-wide human, AI, and total traffic counts' },
    web: { type: 'number', description: 'Assistant queries from the documentation site' },
    api: { type: 'number', description: 'Assistant queries from API calls' },
    other: { type: 'number', description: 'Assistant queries from other sources' },
    total: { type: 'number', description: 'Total assistant queries across all caller types' },
    nextCursor: { type: 'string', description: 'Cursor for the next page of results' },
    hasMore: { type: 'boolean', description: 'Whether additional results are available' },
  },
}

export const MintlifyBlockMeta = {
  tags: ['content-management', 'knowledge-base', 'automation'],
  url: 'https://mintlify.com',
  templates: [
    {
      icon: MintlifyIcon,
      title: 'Mintlify release-notes publisher',
      prompt:
        'Build a workflow that reads merged pull requests from GitHub, has an agent draft release notes, creates a Mintlify agent job to add them to the changelog, and triggers a docs deployment once the pull request merges.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: MintlifyIcon,
      title: 'Mintlify docs-gap reporter',
      prompt:
        'Create a scheduled workflow that exports Mintlify assistant conversations weekly, filters the ones marked unanswered, groups them into themes, and posts the top documentation gaps to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MintlifyIcon,
      title: 'Mintlify support answer bot',
      prompt:
        'Build a workflow that takes an inbound support question, asks the Mintlify docs assistant for an answer, and replies in Slack with the answer and its cited documentation links.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['customer-support', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MintlifyIcon,
      title: 'Mintlify preview deployment on PR',
      prompt:
        'Create a workflow that triggers a Mintlify preview deployment for a Git branch, polls the deployment status until it succeeds or fails, and comments the preview URL on the GitHub pull request.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['ci-cd', 'devops'],
      alsoIntegrations: ['github'],
    },
    {
      icon: MintlifyIcon,
      title: 'Mintlify prose-quality sweeper',
      prompt:
        'Build a scheduled workflow that reads documentation pages from a table, runs the Mintlify AI-prose detector on each one, and writes flagged passages and suggested rewrites back to the table for review.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'analysis'],
    },
    {
      icon: MintlifyIcon,
      title: 'Mintlify feedback triage',
      prompt:
        'Create a scheduled workflow that exports Mintlify user feedback daily, has an agent classify each comment by severity and theme, and opens Linear issues for the ones that need a documentation fix.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['triage', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: MintlifyIcon,
      title: 'Mintlify traffic digest',
      prompt:
        'Build a scheduled workflow that exports Mintlify page views, unique visitors, and top search queries each week, writes them to a table, and emails a digest highlighting pages with rising AI traffic.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['analytics', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: MintlifyIcon,
      title: 'Mintlify knowledge base mirror',
      prompt:
        'Create a workflow that searches a Mintlify documentation site, fetches the full content of each matching page, and loads it into a Sim knowledge base so agents can retrieve it offline.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['sync', 'knowledge-base'],
    },
  ],
  skills: [
    {
      name: 'ship-docs-update',
      description:
        'Trigger a Mintlify documentation deployment and poll until it succeeds or fails.',
      content:
        '# Ship Docs Update\n\nDeploy the latest documentation and confirm it landed.\n\n## Steps\n1. Trigger an update for the Mintlify project and capture the returned status ID.\n2. Poll the update status with that ID until the status is `success` or `failure`.\n3. On failure, read the summary and logs and report what broke.\n4. On success, report the subdomain and the commit that shipped.\n\n## Output\nThe final status, the commit SHA and message, and the deployment logs when the update failed.',
    },
    {
      name: 'answer-from-docs',
      description: 'Answer a question using a Mintlify documentation site and cite the pages used.',
      content:
        '# Answer From Docs\n\nGround an answer in a published Mintlify documentation site.\n\n## Steps\n1. Search the documentation for the question.\n2. Fetch the full content of the most relevant matching pages.\n3. Synthesize an answer using only what those pages say.\n4. If the docs do not cover the question, say so instead of guessing.\n\n## Output\nA concise answer plus the paths of the pages it came from.',
    },
    {
      name: 'find-docs-gaps',
      description:
        'Export Mintlify assistant conversations and surface the questions the docs could not answer.',
      content:
        '# Find Docs Gaps\n\nUse assistant history to find what the documentation is missing.\n\n## Steps\n1. Export assistant conversations for the requested date range.\n2. Keep the ones whose resolution status is `unanswered`.\n3. Group the remaining questions into themes and count how often each appears.\n4. For each theme, name the page that should cover it — existing or new.\n\n## Output\nA ranked list of documentation gaps with example questions and a suggested page for each.',
    },
    {
      name: 'run-docs-agent-job',
      description:
        'Launch a Mintlify agent job to edit documentation and follow it through to a pull request.',
      content:
        '# Run Docs Agent Job\n\nHand a documentation edit to the Mintlify agent.\n\n## Steps\n1. Create an agent job with a specific, scoped instruction.\n2. Poll the job until its status is `completed`, `archived`, or `failed`.\n3. If the result needs adjusting, send a follow-up message to the same job and poll again.\n4. Report the pull request link once one is created.\n\n## Output\nThe final job status and the pull request URL, or an explanation of why no changes were made.',
    },
    {
      name: 'report-docs-traffic',
      description:
        'Export Mintlify views, visitors, and search analytics into a single traffic summary.',
      content:
        '# Report Docs Traffic\n\nSummarize how a documentation site is being read.\n\n## Steps\n1. Export page views and unique visitors for the date range, paginating while `hasMore` is true.\n2. Export the top search queries for the same range.\n3. Compare human and AI traffic per page and flag pages where AI traffic dominates.\n4. Flag search queries with a low click-through rate — they point at missing or poorly titled pages.\n\n## Output\nSite-wide totals, the top pages by traffic, and the search terms that are not finding a good result.',
    },
  ],
} as const satisfies BlockMeta
