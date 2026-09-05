import { TinyFishIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { TinyFishRunResponse } from '@/tools/tinyfish/types'

/** Operations that build and submit an automation run. */
const AUTOMATION_OPERATIONS = ['tinyfish_run', 'tinyfish_run_async']

/** Operations addressed by a single run ID. */
const RUN_ID_OPERATIONS = ['tinyfish_get_run', 'tinyfish_cancel_run']

/**
 * Operations whose tools declare a `hosting` config.
 *
 * The async run bills for steps taken after the request returns, and the run
 * read/cancel/list endpoints are companions to it, so none of them can be
 * metered against a hosted key. They always require the caller's own key.
 */
const HOSTED_KEY_OPERATIONS = ['tinyfish_run', 'tinyfish_search', 'tinyfish_fetch']

const PROXY_COUNTRY_OPTIONS = [
  { label: 'United States', id: 'US' },
  { label: 'United Kingdom', id: 'GB' },
  { label: 'Canada', id: 'CA' },
  { label: 'Germany', id: 'DE' },
  { label: 'France', id: 'FR' },
  { label: 'Japan', id: 'JP' },
  { label: 'Australia', id: 'AU' },
]

export const TinyFishBlock: BlockConfig<TinyFishRunResponse> = {
  type: 'tinyfish',
  name: 'TinyFish',
  description: 'Automate and read the live web',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate TinyFish into the workflow. Give a web agent a natural-language goal and let it drive a real browser on any site, queue and track long-running automations, search the web, and fetch pages as clean markdown.',
  docsLink: 'https://docs.sim.ai/integrations/tinyfish',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#FFFFFF',
  icon: TinyFishIcon,
  canvasPresentation: {
    defaultTitle: 'TinyFish',
    sentences: {
      byOperation: {
        tinyfish_run: [
          { text: 'Run the goal', field: 'goal', core: true },
          { text: 'on', field: 'url' },
        ],
        tinyfish_run_async: [
          { text: 'Queue the goal', field: 'goal', core: true },
          { text: 'on', field: 'url' },
        ],
        tinyfish_get_run: [{ text: 'Get run', field: 'runId', core: true }],
        tinyfish_cancel_run: [{ text: 'Cancel run', field: 'runId', core: true }],
        tinyfish_list_runs: [
          'List runs',
          { text: 'matching', field: 'goalFilter' },
          { text: ', with status', field: 'status' },
        ],
        tinyfish_search: [{ text: 'Search the web for', field: 'query', core: true }],
        tinyfish_fetch: [
          { text: 'Fetch', field: 'urls', core: true },
          { text: 'as', field: 'format' },
        ],
        tinyfish_list_vault_items: ['List credentials from the connected vault'],
        tinyfish_list_profiles: ['List saved browser profiles'],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Run Agent', id: 'tinyfish_run' },
        { label: 'Start Agent Run', id: 'tinyfish_run_async' },
        { label: 'Get Run', id: 'tinyfish_get_run' },
        { label: 'Cancel Run', id: 'tinyfish_cancel_run' },
        { label: 'List Runs', id: 'tinyfish_list_runs' },
        { label: 'Search', id: 'tinyfish_search' },
        { label: 'Fetch URLs', id: 'tinyfish_fetch' },
        { label: 'List Vault Items', id: 'tinyfish_list_vault_items' },
        { label: 'List Browser Profiles', id: 'tinyfish_list_profiles' },
      ],
      value: () => 'tinyfish_run',
    },

    {
      id: 'url',
      title: 'Website URL',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: AUTOMATION_OPERATIONS },
      required: { field: 'operation', value: AUTOMATION_OPERATIONS },
    },
    {
      id: 'goal',
      title: 'Goal',
      type: 'long-input',
      placeholder: 'Find the pricing page and extract every plan name and monthly price',
      condition: { field: 'operation', value: AUTOMATION_OPERATIONS },
      required: { field: 'operation', value: AUTOMATION_OPERATIONS },
    },
    {
      id: 'outputSchema',
      title: 'Output Schema',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "type": "object",\n  "properties": {}\n}',
      description: 'JSON Schema draft-07 contract the extracted result must satisfy',
      condition: { field: 'operation', value: AUTOMATION_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON Schema (draft-07) describing the data the web agent should return.

Rules:
- Root must be an object with a "type" and "properties".
- Use "array" with "items" for repeated records such as products, plans, or listings.
- Only include fields the agent could actually read off the page.
- Mark the fields that must always be present in "required".

Example:
{
  "type": "object",
  "properties": {
    "plans": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "monthlyPrice": { "type": "number" }
        },
        "required": ["name", "monthlyPrice"]
      }
    }
  },
  "required": ["plans"]
}

Return ONLY the JSON Schema - no explanations, no extra text.`,
        placeholder: 'Describe the data you want the agent to bring back...',
        generationType: 'json-schema',
      },
    },
    {
      id: 'browserProfile',
      title: 'Browser Engine',
      type: 'dropdown',
      description: 'Which browser the agent drives. Unrelated to a saved Browser Context Profile',
      options: [
        { label: 'Lite (standard browser)', id: 'lite' },
        { label: 'Stealth (anti-detection)', id: 'stealth' },
      ],
      value: () => 'lite',
      condition: { field: 'operation', value: AUTOMATION_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'agentMode',
      title: 'Agent Mode',
      type: 'dropdown',
      options: [
        { label: 'Default', id: 'default' },
        { label: 'Strict (fail fast)', id: 'strict' },
      ],
      value: () => 'default',
      condition: { field: 'operation', value: AUTOMATION_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'maxSteps',
      title: 'Max Steps',
      type: 'short-input',
      placeholder: '150',
      description: 'Tool-call steps before the agent stops (1-500)',
      condition: { field: 'operation', value: AUTOMATION_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'maxDurationSeconds',
      title: 'Max Duration (seconds)',
      type: 'short-input',
      placeholder: '300',
      description: 'Wall-clock limit before the agent stops. Unlimited when empty',
      condition: { field: 'operation', value: AUTOMATION_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'proxyEnabled',
      title: 'Use Proxy',
      type: 'switch',
      description: 'Route the run through TinyFish’s Tetra proxy',
      condition: { field: 'operation', value: AUTOMATION_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'proxyCountryCode',
      title: 'Proxy Country',
      type: 'dropdown',
      options: PROXY_COUNTRY_OPTIONS,
      condition: {
        field: 'operation',
        value: AUTOMATION_OPERATIONS,
        and: { field: 'proxyEnabled', value: true },
      },
      mode: 'advanced',
    },
    {
      id: 'useVault',
      title: 'Use Vault Credentials',
      type: 'switch',
      description: 'Let the agent log in with credentials from your connected password manager',
      condition: { field: 'operation', value: AUTOMATION_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'credentialItemIds',
      title: 'Vault Credential URIs',
      type: 'short-input',
      placeholder: 'cred:conn-abc:Work:item-123, cred:conn-def:Personal:item-456',
      description:
        'Comma-separated. Run List Vault Items to find them. Leave empty to use every enabled vault item',
      condition: {
        field: 'operation',
        value: AUTOMATION_OPERATIONS,
        and: { field: 'useVault', value: true },
      },
      mode: 'advanced',
    },
    {
      id: 'useProfile',
      title: 'Use Browser Profile',
      type: 'switch',
      description: 'Start the run from a saved browser session, so the agent is already logged in',
      condition: { field: 'operation', value: AUTOMATION_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'profileId',
      title: 'Browser Profile ID',
      type: 'short-input',
      placeholder: 'prof_abc123def4567890',
      description:
        'Run List Browser Profiles to find it. Leave empty to use your default profile, which the run requires you to have set',
      condition: {
        field: 'operation',
        value: AUTOMATION_OPERATIONS,
        and: { field: 'useProfile', value: true },
      },
      mode: 'advanced',
    },
    {
      id: 'webhookUrl',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'https://example.com/tinyfish-webhook',
      description: 'HTTPS endpoint notified when the run completes, fails, or is cancelled',
      condition: { field: 'operation', value: 'tinyfish_run_async' },
      mode: 'advanced',
    },

    {
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      condition: { field: 'operation', value: RUN_ID_OPERATIONS },
      required: { field: 'operation', value: RUN_ID_OPERATIONS },
    },

    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Pending', id: 'PENDING' },
        { label: 'Running', id: 'RUNNING' },
        { label: 'Completed', id: 'COMPLETED' },
        { label: 'Failed', id: 'FAILED' },
        { label: 'Cancelled', id: 'CANCELLED' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'tinyfish_list_runs' },
    },
    {
      id: 'goalFilter',
      title: 'Goal Contains',
      canvasNoun: 'a goal',
      type: 'short-input',
      placeholder: 'pricing',
      condition: { field: 'operation', value: 'tinyfish_list_runs' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20',
      description: 'Runs to return (1-100)',
      condition: { field: 'operation', value: 'tinyfish_list_runs' },
      mode: 'advanced',
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'tinyfish_list_runs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.

Examples:
- "yesterday at midnight UTC" -> 2026-01-01T00:00:00Z
- "start of last week" -> appropriate ISO 8601 date
- "3 days ago" -> appropriate ISO 8601 date

Return ONLY the ISO 8601 timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the cutoff (e.g., "3 days ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'createdBefore',
      title: 'Created Before',
      type: 'short-input',
      placeholder: '2026-02-01T00:00:00Z',
      condition: { field: 'operation', value: 'tinyfish_list_runs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.

Examples:
- "yesterday at midnight UTC" -> 2026-01-01T00:00:00Z
- "start of last week" -> appropriate ISO 8601 date
- "3 days ago" -> appropriate ISO 8601 date

Return ONLY the ISO 8601 timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the cutoff (e.g., "3 days ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'sortDirection',
      title: 'Sort Direction',
      type: 'dropdown',
      options: [
        { label: 'Newest first', id: 'desc' },
        { label: 'Oldest first', id: 'asc' },
      ],
      value: () => 'desc',
      condition: { field: 'operation', value: 'tinyfish_list_runs' },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous page',
      condition: { field: 'operation', value: 'tinyfish_list_runs' },
      mode: 'advanced',
    },

    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'web automation tools',
      condition: { field: 'operation', value: 'tinyfish_search' },
      required: { field: 'operation', value: 'tinyfish_search' },
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      placeholder: 'US',
      description: 'Country code for geo-targeted results',
      condition: { field: 'operation', value: 'tinyfish_search' },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'en',
      description: 'Language code for the results',
      condition: { field: 'operation', value: 'tinyfish_search' },
      mode: 'advanced',
    },

    {
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      placeholder: 'https://example.com, https://example.org',
      description: 'Comma-separated, 1-10 URLs. Each is fetched independently',
      condition: { field: 'operation', value: 'tinyfish_fetch' },
      required: { field: 'operation', value: 'tinyfish_fetch' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of at most 10 absolute URLs from the user's description.

Rules:
- Every entry must start with http:// or https://.
- Separate entries with a comma and a space.
- Never invent a page that would not plausibly exist.

Return ONLY the comma-separated URL list - no explanations, no extra text.`,
        placeholder: 'Describe the pages to fetch...',
      },
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'Markdown', id: 'markdown' },
        { label: 'HTML', id: 'html' },
        { label: 'JSON document tree', id: 'json' },
      ],
      value: () => 'markdown',
      condition: { field: 'operation', value: 'tinyfish_fetch' },
    },
    {
      id: 'links',
      title: 'Extract Links',
      type: 'switch',
      condition: { field: 'operation', value: 'tinyfish_fetch' },
      mode: 'advanced',
    },
    {
      id: 'imageLinks',
      title: 'Extract Image Links',
      type: 'switch',
      condition: { field: 'operation', value: 'tinyfish_fetch' },
      mode: 'advanced',
    },

    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your TinyFish API key',
      password: true,
      required: true,
      hideWhenHosted: true,
      condition: { field: 'operation', value: HOSTED_KEY_OPERATIONS },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your TinyFish API key',
      password: true,
      required: true,
      condition: { field: 'operation', value: HOSTED_KEY_OPERATIONS, not: true },
    },
  ],
  tools: {
    access: [
      'tinyfish_run',
      'tinyfish_run_async',
      'tinyfish_get_run',
      'tinyfish_cancel_run',
      'tinyfish_list_runs',
      'tinyfish_search',
      'tinyfish_fetch',
      'tinyfish_list_vault_items',
      'tinyfish_list_profiles',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'tinyfish_run_async':
            return 'tinyfish_run_async'
          case 'tinyfish_get_run':
            return 'tinyfish_get_run'
          case 'tinyfish_cancel_run':
            return 'tinyfish_cancel_run'
          case 'tinyfish_list_runs':
            return 'tinyfish_list_runs'
          case 'tinyfish_search':
            return 'tinyfish_search'
          case 'tinyfish_fetch':
            return 'tinyfish_fetch'
          case 'tinyfish_list_vault_items':
            return 'tinyfish_list_vault_items'
          case 'tinyfish_list_profiles':
            return 'tinyfish_list_profiles'
          default:
            return 'tinyfish_run'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}

        /**
         * A numeric text input that does not parse is rejected rather than
         * dropped. Omitting it silently hands the run TinyFish's default — no
         * wall-clock limit at all for Max Duration — while the block still
         * shows the value the user typed.
         */
        const toFiniteNumber = (value: string, field: string): number => {
          const parsed = Number(value)
          if (!Number.isFinite(parsed)) {
            throw new Error(`Invalid numeric value for ${field}: ${value}`)
          }
          return parsed
        }

        const maxSteps = String(params.maxSteps ?? '').trim()
        if (maxSteps) result.maxSteps = toFiniteNumber(maxSteps, 'Max Steps')

        const maxDurationSeconds = String(params.maxDurationSeconds ?? '').trim()
        if (maxDurationSeconds) {
          result.maxDurationSeconds = toFiniteNumber(maxDurationSeconds, 'Max Duration (seconds)')
        }

        const limit = String(params.limit ?? '').trim()
        if (limit) result.limit = toFiniteNumber(limit, 'Limit')

        /**
         * The list filter has its own sub-block id so it does not collide with
         * the automation goal, and is renamed here to the `goal` query the tool
         * sends.
         */
        if (params.operation === 'tinyfish_list_runs') {
          result.goal = params.goalFilter
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'TinyFish API key' },
    url: { type: 'string', description: 'Website the agent starts on' },
    goal: { type: 'string', description: 'Natural-language goal for the agent' },
    outputSchema: { type: 'json', description: 'JSON Schema contract for the result' },
    browserProfile: { type: 'string', description: 'Browser engine: lite or stealth' },
    agentMode: { type: 'string', description: 'Agent behavior: default or strict' },
    maxSteps: { type: 'number', description: 'Maximum agent steps' },
    maxDurationSeconds: {
      type: 'number',
      description: 'Maximum wall-clock seconds before the agent stops',
    },
    proxyEnabled: { type: 'boolean', description: 'Route the run through the Tetra proxy' },
    proxyCountryCode: { type: 'string', description: 'Proxy country code' },
    useVault: { type: 'boolean', description: 'Allow vault credentials during the run' },
    credentialItemIds: { type: 'string', description: 'Comma-separated vault credential URIs' },
    useProfile: { type: 'boolean', description: 'Start the run from a saved browser session' },
    profileId: { type: 'string', description: 'Browser Context Profile to start the run from' },
    webhookUrl: { type: 'string', description: 'HTTPS endpoint notified on run lifecycle events' },
    runId: { type: 'string', description: 'Run identifier' },
    status: { type: 'string', description: 'Run status filter' },
    goalFilter: { type: 'string', description: 'Goal text filter' },
    createdAfter: { type: 'string', description: 'Only runs created after this timestamp' },
    createdBefore: { type: 'string', description: 'Only runs created before this timestamp' },
    sortDirection: { type: 'string', description: 'Sort order by creation time' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    limit: { type: 'number', description: 'Maximum runs to return' },
    query: { type: 'string', description: 'Search query' },
    location: { type: 'string', description: 'Country code for geo-targeted results' },
    language: { type: 'string', description: 'Language code for the results' },
    urls: { type: 'string', description: 'Comma-separated URLs to fetch' },
    format: { type: 'string', description: 'Fetch extraction format' },
    links: { type: 'boolean', description: 'Extract outbound links' },
    imageLinks: { type: 'boolean', description: 'Extract image links' },
  },
  outputs: {
    runId: { type: 'string', description: 'Run identifier' },
    status: { type: 'string', description: 'Run status' },
    goal: { type: 'string', description: 'Goal the run was given' },
    createdAt: { type: 'string', description: 'When the run was created' },
    startedAt: { type: 'string', description: 'When the run started executing' },
    finishedAt: { type: 'string', description: 'When the run finished' },
    cancelledAt: { type: 'string', description: 'When the run was cancelled' },
    numOfSteps: { type: 'number', description: 'Steps the agent took' },
    result: { type: 'json', description: 'Structured data the agent extracted' },
    schemaValidation: {
      type: 'json',
      description:
        'Result validation against the output schema (valid, rePromptAttempts, errors[{path, expected, received, message}])',
    },
    error: {
      type: 'json',
      description:
        'Failure details for a failed run (code, message, category, retryAfter, helpUrl, helpMessage)',
    },
    streamingUrl: { type: 'string', description: 'Live browser view URL while the run executes' },
    videoUrl: { type: 'string', description: 'Presigned recording URL, expires in 15 minutes' },
    browserConfig: {
      type: 'json',
      description: 'Proxy settings the run executed with (proxyEnabled, proxyCountryCode)',
    },
    steps: {
      type: 'json',
      description:
        'Steps the agent took during the run [{id, timestamp, status, action, duration}]',
    },
    message: { type: 'string', description: 'Context returned by a cancellation' },
    runs: {
      type: 'json',
      description:
        'Runs matching the list filters [{runId, status, goal, createdAt, startedAt, finishedAt, numOfSteps, result, schemaValidation, error, streamingUrl, browserConfig, profileAttached, profileId, profileHint}]',
    },
    total: { type: 'number', description: 'Total runs matching the list filters' },
    nextCursor: { type: 'string', description: 'Cursor for the next page of runs' },
    hasMore: { type: 'boolean', description: 'Whether more runs follow this page' },
    query: { type: 'string', description: 'Search query that was executed' },
    results: {
      type: 'json',
      description:
        'Search results [{position, siteName, snippet, title, url}], or fetched pages [{url, finalUrl, title, description, language, format, text, author, publishedDate, links, imageLinks, latencyMs}]',
    },
    totalResults: { type: 'number', description: 'Number of search results returned' },
    errors: { type: 'json', description: 'URLs the fetch could not retrieve [{url, error}]' },
    items: {
      type: 'json',
      description:
        'Vault credentials available to a run [{itemId, connectionId, label, vaultName, domains, fieldMetadata, hasTotp}]',
    },
    profileId: {
      type: 'string',
      description: 'Browser Context Profile the run attached, null when none did',
    },
    profileAttached: {
      type: 'boolean',
      description: 'Whether the run actually started from a Browser Context Profile',
    },
    profileHint: {
      type: 'json',
      description:
        'Set when TinyFish believes a Browser Context Profile would fix a failed run {message, setupUrl, reason} — reason is auth_wall or bot_challenge',
    },
    profiles: {
      type: 'json',
      description:
        'Browser Context Profiles a run can start from [{profileId, name, proxyCountryCode, fingerprintSeed, domainCount, createdAt, updatedAt, isDefault}]. Every field but profileId and name can be null when the API omits it',
    },
  },
}

export const TinyFishBlockMeta = {
  tags: ['web-scraping', 'automation', 'agentic'],
  url: 'https://www.tinyfish.ai',
  templates: [
    {
      icon: TinyFishIcon,
      title: 'TinyFish competitor pricing watch',
      prompt:
        'Create a scheduled workflow that runs a TinyFish agent weekly against three competitor pricing pages, extracts every plan name and monthly price into a fixed output schema, diffs it against the table from last week, and posts the changes to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TinyFishIcon,
      title: 'TinyFish supplier portal collector',
      prompt:
        'Build a workflow that uses a TinyFish agent with vault credentials to log into supplier portals that have no API, download the outstanding invoices, and write the invoice metadata to a finance table.',
      modules: ['scheduled', 'tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: TinyFishIcon,
      title: 'TinyFish research briefing',
      prompt:
        'Create a workflow that uses TinyFish Search to find the top sources on a topic, fetches each one as clean markdown, and has an agent write a cited briefing to a file.',
      modules: ['files', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['research', 'content'],
    },
    {
      icon: TinyFishIcon,
      title: 'TinyFish lead site enrichment',
      prompt:
        'Build a workflow that reads company domains from a table, fetches each homepage and pricing page with TinyFish, extracts positioning and price points into a schema, and writes the enriched rows back.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['enrichment', 'research'],
    },
    {
      icon: TinyFishIcon,
      title: 'TinyFish long-running run tracker',
      prompt:
        'Create a workflow that queues a TinyFish agent run asynchronously, stores the run ID in a table, and a second scheduled workflow that polls each open run, writes the extracted result back, and cancels runs older than an hour.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'monitoring'],
    },
    {
      icon: TinyFishIcon,
      title: 'TinyFish signup flow QA',
      prompt:
        'Build a workflow that runs a TinyFish agent in strict mode against the staging signup flow every morning, checks that account creation succeeds end to end, and opens a Linear issue with the failing step when it does not.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: TinyFishIcon,
      title: 'TinyFish review monitor',
      prompt:
        'Create a scheduled workflow that uses TinyFish Search to find new reviews mentioning your product, fetches each review page, classifies sentiment with an agent, and writes notable reviews to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: TinyFishIcon,
      title: 'TinyFish regulatory filing digest',
      prompt:
        'Build a workflow that fetches a regulator’s notices page with TinyFish every morning, extracts new filings into a schema, and emails a digest of anything matching your watch list.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'extract-structured-data-from-site',
      description:
        'Drive a TinyFish web agent to navigate a site and return data matching a JSON schema. Use to pull records — prices, listings, table rows — from pages that have no API.',
      content:
        '# Extract Structured Data From Site\n\nUse the TinyFish Run Agent operation to read a website and return structured data.\n\n## Steps\n1. Set Website URL to the page the agent should start on. Starting closer to the data costs fewer steps.\n2. Write a Goal that names exactly what to collect and where, e.g. "open the pricing page and collect every plan name and monthly price".\n3. Provide an Output Schema (JSON Schema draft-07) describing the fields you want back. TinyFish re-prompts the agent when the result does not match and reports the mismatches in `schemaValidation`.\n4. Raise Max Steps for deeper flows; switch Browser Engine to Stealth when the site blocks automation.\n\n## Output\nReturn the extracted `result` object. Check `schemaValidation.valid` before trusting it, and report any field the agent could not find rather than filling it in.',
    },
    {
      name: 'automate-web-task',
      description:
        'Have a TinyFish agent complete a multi-step task on a website — logging in, navigating, filling and submitting forms. Use when a site has no API and a person would normally do the clicks.',
      content:
        '# Automate Web Task\n\nUse the TinyFish Run Agent operation to complete a goal-oriented task on the web.\n\n## Steps\n1. Set Website URL to the entry point and write a Goal that states the steps and the success condition, e.g. "log in, open Billing, download the latest invoice".\n2. Turn on Use Browser Profile to start from a session that is already logged in, and give a Browser Profile ID to pick one. Turn on Use Vault Credentials when the task needs to log in itself, and scope it with Vault Credential URIs so only the intended credential is available. Pairing both lets TinyFish repair a profile whose session has expired.\n3. Use Agent Mode "strict" when the run is a test that should fail fast instead of improvising.\n4. Enable Use Proxy and pick a Proxy Country when the site is geo-restricted.\n\n## Output\nReport whether the run completed, what the agent extracted, and the step count. On failure, quote the `error` message and category — AGENT_FAILURE means the goal needs rewording, SYSTEM_FAILURE is worth retrying.',
    },
    {
      name: 'search-and-read-the-web',
      description:
        'Search the web with TinyFish and fetch the winning pages as clean markdown. Use to gather current sources before writing or answering.',
      content:
        '# Search And Read The Web\n\nPair the TinyFish Search and Fetch URLs operations to gather sources.\n\n## Steps\n1. Run Search with a specific Query. Set Location and Language when the answer is regional.\n2. Pick the result URLs worth reading — position and snippet tell you which.\n3. Run Fetch URLs with up to 10 of those URLs and Format "markdown". Turn on Extract Links when you need to follow deeper pages.\n4. Per-URL failures land in `errors` and never fail the whole call, so check it before assuming a page was read.\n\n## Output\nSummarize from the fetched text and cite each claim with the source URL. Say which URLs failed instead of quietly dropping them.',
    },
    {
      name: 'scope-a-run-to-one-vault-credential',
      description:
        'Find the TinyFish vault credential URI for a site and scope a single agent run to it. Use when a run needs one specific login and must not see the rest of the vault.',
      content:
        '# Scope A Run To One Vault Credential\n\nUse List Vault Items to discover credential URIs, then pass one to a run.\n\n## Steps\n1. Run the List Vault Items operation. It returns display-safe metadata only — `itemId`, `label`, `vaultName`, `domains`, and whether the credential carries a TOTP. No secret values ever leave TinyFish.\n2. Pick the item whose `domains` match the site you are automating and copy its `itemId` (it looks like `cred:conn-abc:Work:item-123`).\n3. On the Run Agent operation, turn on Use Vault Credentials and paste that `itemId` into Vault Credential URIs. Leaving the field empty exposes every enabled item to the run instead.\n4. Write the goal to reference the login by intent — "sign in and open Billing" — not by pasting any credential.\n\n## Output\nReport which credential the run used by label, and whether the login succeeded. Never echo credential values; they are not returned and must not be reconstructed. If `hasTotp` is false and the site demands a second factor, say so rather than retrying.',
    },
    {
      name: 'diagnose-a-failed-run',
      description:
        'Read a failed TinyFish run and decide whether to retry, reword the goal, or escalate. Use when an automation returns FAILED or a workflow keeps burning steps without a result.',
      content:
        '# Diagnose A Failed Run\n\nA failed automation comes back as a normal 200 response with the failure inside the run, so read `status` before trusting `result`.\n\n## Steps\n1. Read `error.category`. `AGENT_FAILURE` means the goal or the page is the problem — reword the goal or start the run closer to the target. `SYSTEM_FAILURE` is TinyFish-side; wait `error.retryAfter` seconds and retry the same input. `BILLING_FAILURE` means the TinyFish wallet is empty and no retry will help. `UNKNOWN` should be treated as retryable once.\n2. Read `profileHint` whenever it is set — TinyFish attaches it only when a Browser Context Profile would likely fix the run, so it outranks the category above. `reason` is `auth_wall` (the agent hit a login) or `bot_challenge` (the site blocked automation); the fix is to set up a profile for that domain and rerun with Use Browser Profile on, not to reword the goal.\n3. Compare `numOfSteps` against the Max Steps you set. Hitting the cap means the agent was still working, so raise the cap or narrow the goal. If the run instead stopped early on a slow page, set Max Duration.\n4. If an Output Schema was set, read `schemaValidation.errors` — a run can reach the right page and still fail on one mistyped field, and `rePromptAttempts` shows how hard TinyFish already tried to repair it.\n5. For an async run, call Get Run and read the `steps` list to find the last action before the failure. `videoUrl` gives a recording, but the link expires 15 minutes after it is issued.\n\n## Output\nState the category, the concrete cause, and the single next action. Quote `error.message` rather than paraphrasing it, and do not retry a `BILLING_FAILURE` or an `AGENT_FAILURE` without changing the input first.',
    },
    {
      name: 'queue-and-track-long-runs',
      description:
        'Queue a TinyFish agent run without waiting, then poll or cancel it by ID. Use for automations too long to hold a workflow step open.',
      content:
        '# Queue And Track Long Runs\n\nUse Start Agent Run, then Get Run, Cancel Run, and List Runs to manage work asynchronously.\n\n## Steps\n1. Start Agent Run with the URL and Goal. It returns a `runId` immediately. Set a Webhook URL if something should be notified on completion.\n2. Store the `runId`, then call Get Run to read `status`, `result`, and the step history. `numOfSteps` stays null while the run is in progress.\n3. Call Cancel Run to stop a queued or running automation. It is idempotent — a run that already finished comes back with its terminal status and a message saying so.\n4. Use List Runs with a status or goal filter to find runs you did not record the ID for.\n\n## Output\nReport the run status and, once COMPLETED, the extracted `result`. Note that these operations always need your own TinyFish API key — they are not covered by Sim’s hosted key.',
    },
  ],
} as const satisfies BlockMeta
