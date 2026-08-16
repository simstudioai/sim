import { SplunkIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { SplunkResponse } from '@/tools/splunk/types'

/**
 * Normalize a Splunk toggle. A dropdown supplies the strings `'true'`/`'false'`,
 * while a workflow variable, an agent tool call, or a block created over the API
 * supplies a real boolean — so both forms must survive. An untouched subBlock
 * resolves to `null`, which stays `undefined` here so the field is omitted from
 * the request and Splunk applies its own documented default.
 */
function toSplunkToggle(value: unknown): boolean | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'boolean') return value
  return value !== 'false' && value !== '0'
}

/**
 * Assign a numeric Splunk field, dropping anything that is not a finite number.
 *
 * A bare `Number()` turns a typo like `abc` into `NaN`, which serializes into the
 * query string or form body as the literal `NaN` — Splunk then rejects the whole
 * request with an error that names the field but not the cause. Omitting the field
 * instead lets Splunk apply its own documented default, which is what an unusable
 * value should fall back to.
 *
 * An untouched subBlock resolves to `null` and an empty one to `''`; both are
 * omissions rather than zeros, so neither may reach `Number()` (which reads both
 * as `0`).
 *
 * The key is always written, never skipped. The executor merges this mapper's
 * return *over* the raw serialized subBlock values, so a key left unwritten keeps
 * the raw string (`'1,000'`) and forwards the typo to Splunk verbatim — the
 * opposite of omitting it. Writing `undefined` erases it instead, and both
 * `buildSplunkFormBody` and `buildSplunkUrl` drop nullish fields from the request.
 */
function assignSplunkNumber(target: Record<string, unknown>, key: string, value: unknown): void {
  const parsed = value == null || value === '' ? Number.NaN : Number(value)
  target[key] = Number.isFinite(parsed) ? parsed : undefined
}

export const SplunkBlock: BlockConfig<SplunkResponse> = {
  type: 'splunk',
  name: 'Splunk',
  description: 'Run SPL searches and manage saved searches and alerts in Splunk',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Splunk Enterprise or Splunk Cloud into workflows. Run SPL searches synchronously or as asynchronous jobs, fetch results, dispatch saved searches, and inspect fired alerts and indexes.',
  docsLink: 'https://docs.sim.ai/integrations/splunk',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#FFFFFF',
  icon: SplunkIcon,
  canvasPresentation: {
    defaultTitle: 'Splunk',
    sentences: {
      byOperation: {
        splunk_run_search: [
          { text: 'Run search', field: 'search', core: true },
          { text: ', from', field: 'earliestTime' },
          { text: ', until', field: 'latestTime' },
        ],
        splunk_create_search_job: [
          { text: 'Start search job for', field: 'search', core: true },
          { text: ', from', field: 'earliestTime' },
          { text: ', until', field: 'latestTime' },
        ],
        splunk_get_search_job: [{ text: 'Check search job', field: 'sid', core: true }],
        splunk_get_search_results: [
          { text: 'Fetch results of search job', field: 'sid', core: true },
          { text: ', returning at most', field: 'count' },
          { text: ', starting at', field: 'offset' },
        ],
        splunk_cancel_search_job: [{ text: 'Cancel search job', field: 'sid', core: true }],
        splunk_list_saved_searches: [
          'List saved searches',
          { text: ', matching', field: 'savedSearchFilter' },
          { text: ', returning at most', field: 'count' },
        ],
        splunk_get_saved_search: [
          { text: 'Fetch saved search', field: 'savedSearchName', core: true },
        ],
        splunk_dispatch_saved_search: [
          { text: 'Run saved search', field: 'savedSearchName', core: true },
          { text: ', from', field: 'dispatchEarliestTime' },
          { text: ', until', field: 'dispatchLatestTime' },
        ],
        splunk_list_fired_alerts: [
          'List fired alerts',
          { text: ', returning at most', field: 'count' },
        ],
        splunk_get_fired_alerts: [
          { text: 'Fetch fired alerts for', field: 'alertName', core: true },
        ],
        splunk_list_indexes: [
          'List indexes',
          { text: ', of type', field: 'datatype' },
          { text: ', returning at most', field: 'count' },
        ],
        splunk_list_apps: ['List apps', { text: ', returning at most', field: 'count' }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Run Search', id: 'splunk_run_search' },
        { label: 'Create Search Job', id: 'splunk_create_search_job' },
        { label: 'Get Search Job', id: 'splunk_get_search_job' },
        { label: 'Get Search Results', id: 'splunk_get_search_results' },
        { label: 'Cancel Search Job', id: 'splunk_cancel_search_job' },
        { label: 'List Saved Searches', id: 'splunk_list_saved_searches' },
        { label: 'Get Saved Search', id: 'splunk_get_saved_search' },
        { label: 'Dispatch Saved Search', id: 'splunk_dispatch_saved_search' },
        { label: 'List Fired Alerts', id: 'splunk_list_fired_alerts' },
        { label: 'Get Fired Alerts', id: 'splunk_get_fired_alerts' },
        { label: 'List Indexes', id: 'splunk_list_indexes' },
        { label: 'List Apps', id: 'splunk_list_apps' },
      ],
      value: () => 'splunk_run_search',
    },

    {
      id: 'baseUrl',
      title: 'Splunk URL',
      type: 'short-input',
      placeholder: 'https://splunk.example.com:8089',
      required: true,
    },
    {
      id: 'authToken',
      title: 'Authentication Token',
      type: 'short-input',
      placeholder: 'Splunk bearer token',
      password: true,
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Only needed without a token',
      mode: 'advanced',
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Only needed without a token',
      password: true,
      mode: 'advanced',
    },
    {
      id: 'owner',
      title: 'Namespace Owner',
      type: 'short-input',
      placeholder: '-',
      mode: 'advanced',
    },
    {
      id: 'app',
      title: 'Namespace App',
      type: 'short-input',
      placeholder: 'search',
      mode: 'advanced',
    },

    {
      id: 'search',
      title: 'SPL Search',
      type: 'long-input',
      placeholder: 'index=main error | stats count by host',
      required: true,
      condition: {
        field: 'operation',
        value: ['splunk_run_search', 'splunk_create_search_job'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Splunk SPL search from the user's description.

Rules:
- Return ONLY the SPL string, no explanations, no quotes, no code fences.
- Start with an index filter when the user names a data source (e.g. index=main).
- Use pipes for transforming commands (e.g. | stats count by host).

Examples:
- "errors in the main index in the last hour grouped by host" -> index=main error | stats count by host
- "top 10 slowest web requests" -> index=web | sort - duration | head 10`,
        placeholder: 'Describe the search you want to run...',
      },
    },
    {
      id: 'earliestTime',
      title: 'Earliest Time',
      type: 'short-input',
      placeholder: '-24h',
      condition: {
        field: 'operation',
        value: ['splunk_run_search', 'splunk_create_search_job'],
      },
    },
    {
      id: 'latestTime',
      title: 'Latest Time',
      type: 'short-input',
      placeholder: 'now',
      condition: {
        field: 'operation',
        value: ['splunk_run_search', 'splunk_create_search_job'],
      },
    },
    {
      id: 'adhocSearchLevel',
      title: 'Search Mode',
      type: 'dropdown',
      options: [
        { label: 'Fast', id: 'fast' },
        { label: 'Smart', id: 'smart' },
        { label: 'Verbose', id: 'verbose' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['splunk_run_search', 'splunk_create_search_job'],
      },
    },
    {
      id: 'autoCancel',
      title: 'Auto-Cancel After (seconds)',
      type: 'short-input',
      placeholder: '0 never auto-cancels',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['splunk_run_search', 'splunk_create_search_job'],
      },
    },
    {
      id: 'maxCount',
      title: 'Max Stored Results',
      type: 'short-input',
      placeholder: '10000',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['splunk_run_search', 'splunk_create_search_job'],
      },
    },
    {
      id: 'execMode',
      title: 'Execution Mode',
      type: 'dropdown',
      options: [
        { label: 'Normal (returns sid immediately)', id: 'normal' },
        { label: 'Blocking (returns sid when done)', id: 'blocking' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_create_search_job' },
    },
    {
      id: 'searchId',
      title: 'Custom Search ID',
      type: 'short-input',
      placeholder: 'Generated automatically when empty',
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_create_search_job' },
    },
    {
      id: 'indexEarliest',
      title: 'Index Earliest Time',
      type: 'short-input',
      placeholder: '-24h',
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_create_search_job' },
    },
    {
      id: 'indexLatest',
      title: 'Index Latest Time',
      type: 'short-input',
      placeholder: 'now',
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_create_search_job' },
    },
    {
      id: 'enableLookups',
      title: 'Enable Lookups',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_create_search_job' },
    },
    {
      id: 'allowPartialResults',
      title: 'Allow Partial Results',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_create_search_job' },
    },

    {
      id: 'sid',
      title: 'Search ID',
      type: 'short-input',
      placeholder: '1457683115.100',
      required: true,
      condition: {
        field: 'operation',
        value: ['splunk_get_search_job', 'splunk_get_search_results', 'splunk_cancel_search_job'],
      },
    },
    {
      id: 'fields',
      title: 'Fields',
      type: 'short-input',
      placeholder: '_time, host, source (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_get_search_results' },
    },
    {
      id: 'addSummaryToMetadata',
      title: 'Include Field Summary',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_get_search_results' },
    },

    {
      id: 'savedSearchName',
      title: 'Saved Search Name',
      type: 'short-input',
      placeholder: 'Errors in the last 24 hours',
      required: true,
      condition: {
        field: 'operation',
        value: ['splunk_get_saved_search', 'splunk_dispatch_saved_search'],
      },
    },
    {
      id: 'savedSearchFilter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'name=Errors*',
      condition: { field: 'operation', value: 'splunk_list_saved_searches' },
    },
    {
      id: 'triggerActions',
      title: 'Trigger Alert Actions',
      type: 'switch',
      condition: { field: 'operation', value: 'splunk_dispatch_saved_search' },
    },
    {
      id: 'dispatchEarliestTime',
      title: 'Earliest Time Override',
      type: 'short-input',
      placeholder: '-24h',
      condition: { field: 'operation', value: 'splunk_dispatch_saved_search' },
    },
    {
      id: 'dispatchLatestTime',
      title: 'Latest Time Override',
      type: 'short-input',
      placeholder: 'now',
      condition: { field: 'operation', value: 'splunk_dispatch_saved_search' },
    },
    {
      id: 'dispatchMaxCount',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10000',
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_dispatch_saved_search' },
    },
    {
      id: 'dispatchMaxTime',
      title: 'Max Run Time (seconds)',
      type: 'short-input',
      placeholder: '300',
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_dispatch_saved_search' },
    },
    {
      id: 'dispatchTtl',
      title: 'Artifact TTL (seconds)',
      type: 'short-input',
      placeholder: '600',
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_dispatch_saved_search' },
    },

    {
      id: 'forceDispatch',
      title: 'Force Dispatch',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'splunk_dispatch_saved_search' },
    },

    {
      id: 'alertName',
      title: 'Alerting Saved Search',
      type: 'short-input',
      placeholder: 'Errors in the last 24 hours',
      required: true,
      condition: { field: 'operation', value: 'splunk_get_fired_alerts' },
    },
    {
      id: 'datatype',
      title: 'Index Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Event', id: 'event' },
        { label: 'Metric', id: 'metric' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'splunk_list_indexes' },
    },

    /**
     * One Max Results field serves five operations whose defaults differ (30 for
     * the four collection endpoints, 100 for search results) and whose handling of
     * `count=0` differs too — the collections read it as "every entry", while
     * search results reject it because nothing downstream bounds that read. This
     * block keeps subBlock ids unique, so rather than state one group's rule as if
     * it were shared, the placeholder states neither and the per-operation detail
     * lives in the `count` input description.
     */
    {
      id: 'count',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Leave empty for the Splunk default',
      condition: {
        field: 'operation',
        value: [
          'splunk_get_search_results',
          'splunk_list_saved_searches',
          'splunk_list_fired_alerts',
          'splunk_list_indexes',
          'splunk_list_apps',
        ],
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'splunk_get_search_results',
          'splunk_list_saved_searches',
          'splunk_list_fired_alerts',
          'splunk_list_indexes',
          'splunk_list_apps',
        ],
      },
    },
  ],

  tools: {
    access: [
      'splunk_run_search',
      'splunk_create_search_job',
      'splunk_get_search_job',
      'splunk_get_search_results',
      'splunk_cancel_search_job',
      'splunk_list_saved_searches',
      'splunk_get_saved_search',
      'splunk_dispatch_saved_search',
      'splunk_list_fired_alerts',
      'splunk_get_fired_alerts',
      'splunk_list_indexes',
      'splunk_list_apps',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const result: Record<string, unknown> = {}

        assignSplunkNumber(result, 'count', params.count)
        assignSplunkNumber(result, 'offset', params.offset)

        switch (params.operation) {
          case 'splunk_run_search':
            assignSplunkNumber(result, 'autoCancel', params.autoCancel)
            assignSplunkNumber(result, 'maxCount', params.maxCount)
            break
          case 'splunk_create_search_job':
            assignSplunkNumber(result, 'autoCancel', params.autoCancel)
            assignSplunkNumber(result, 'maxCount', params.maxCount)
            result.enableLookups = toSplunkToggle(params.enableLookups)
            result.allowPartialResults = toSplunkToggle(params.allowPartialResults)
            break
          case 'splunk_get_search_results':
            result.addSummaryToMetadata = toSplunkToggle(params.addSummaryToMetadata)
            break
          case 'splunk_list_saved_searches':
            result.search = params.savedSearchFilter ?? ''
            break
          case 'splunk_get_saved_search':
          case 'splunk_dispatch_saved_search':
            result.name = params.savedSearchName
            result.triggerActions = toSplunkToggle(params.triggerActions)
            result.forceDispatch = toSplunkToggle(params.forceDispatch)
            assignSplunkNumber(result, 'dispatchMaxCount', params.dispatchMaxCount)
            assignSplunkNumber(result, 'dispatchMaxTime', params.dispatchMaxTime)
            assignSplunkNumber(result, 'dispatchTtl', params.dispatchTtl)
            break
          case 'splunk_get_fired_alerts':
            result.name = params.alertName
            break
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    baseUrl: { type: 'string', description: 'Splunk management URL including port' },
    authToken: { type: 'string', description: 'Splunk authentication (bearer) token' },
    username: { type: 'string', description: 'Username for basic authentication' },
    password: { type: 'string', description: 'Password for basic authentication' },
    owner: { type: 'string', description: 'Namespace owner for /servicesNS requests' },
    app: { type: 'string', description: 'Namespace app context for /servicesNS requests' },
    search: { type: 'string', description: 'SPL search string' },
    earliestTime: { type: 'string', description: 'Earliest time bound for the search' },
    latestTime: { type: 'string', description: 'Latest time bound for the search' },
    adhocSearchLevel: { type: 'string', description: 'Search mode: fast, smart, or verbose' },
    autoCancel: { type: 'number', description: 'Seconds of inactivity before auto-cancelling' },
    execMode: { type: 'string', description: 'Execution mode: normal or blocking' },
    searchId: { type: 'string', description: 'Custom search ID for the new job' },
    indexEarliest: { type: 'string', description: 'Earliest index-time bound' },
    indexLatest: { type: 'string', description: 'Latest index-time bound' },
    enableLookups: { type: 'boolean', description: 'Whether lookups are applied to events' },
    allowPartialResults: {
      type: 'boolean',
      description: 'Whether partial results are allowed when a search peer fails',
    },
    maxCount: {
      type: 'number',
      description: 'Maximum number of results the search stores and returns',
    },
    sid: { type: 'string', description: 'Search ID of an existing job' },
    fields: { type: 'string', description: 'Comma-separated fields to return per result row' },
    addSummaryToMetadata: {
      type: 'boolean',
      description: 'Include field summary statistics with the results',
    },
    name: { type: 'string', description: 'Saved search or alerting saved search name' },
    savedSearchName: { type: 'string', description: 'Name of the saved search' },
    savedSearchFilter: { type: 'string', description: 'Filter expression for saved searches' },
    alertName: { type: 'string', description: 'Name of the alerting saved search' },
    triggerActions: {
      type: 'boolean',
      description: 'Whether to trigger alert actions when dispatching',
    },
    dispatchEarliestTime: {
      type: 'string',
      description: 'Earliest time override for the dispatch',
    },
    dispatchLatestTime: { type: 'string', description: 'Latest time override for the dispatch' },
    dispatchMaxCount: { type: 'number', description: 'Maximum results before finalizing' },
    dispatchMaxTime: { type: 'number', description: 'Maximum run time in seconds' },
    dispatchTtl: { type: 'number', description: 'Time to live for the search artifacts' },
    forceDispatch: {
      type: 'boolean',
      description: 'Whether to dispatch even when the saved search is already running',
    },
    datatype: { type: 'string', description: 'Index type filter: all, event, or metric' },
    count: {
      type: 'number',
      description:
        'Maximum number of entries to return. The Splunk default is 30 for the collection endpoints and 100 for search results. The collection endpoints read 0 as "return every entry"; search results reject it, since a completed job can hold hundreds of thousands of rows.',
    },
    offset: { type: 'number', description: 'Index of the first entry to return' },
  },

  outputs: {
    results: {
      type: 'json',
      description: 'Search result rows, each holding the fields the search produced',
    },
    resultCount: { type: 'number', description: 'Number of result rows returned' },
    preview: { type: 'boolean', description: 'Whether the results are previews' },
    initOffset: { type: 'number', description: 'Offset of the first returned row' },
    messages: {
      type: 'json',
      description:
        'Messages returned with the response. An array of {type, text} for the search and job-control operations; Get Search Job instead returns the job entry messages object.',
    },
    sid: { type: 'string', description: 'Search ID of the job' },
    label: { type: 'string', description: 'Custom name of the search job' },
    dispatchState: { type: 'string', description: 'Current state of the search job' },
    doneProgress: { type: 'number', description: 'Approximate job progress between 0 and 1' },
    isDone: { type: 'boolean', description: 'Whether the search has completed' },
    isFailed: { type: 'boolean', description: 'Whether the search failed' },
    isFinalized: { type: 'boolean', description: 'Whether the search was finalized' },
    isPaused: { type: 'boolean', description: 'Whether the search is paused' },
    isZombie: { type: 'boolean', description: 'Whether the search process died' },
    isSaved: { type: 'boolean', description: 'Whether the job artifacts are saved' },
    isSavedSearch: { type: 'boolean', description: 'Whether the job came from a saved search' },
    isRealTimeSearch: { type: 'boolean', description: 'Whether this is a real-time search' },
    eventCount: { type: 'number', description: 'Number of events returned' },
    eventAvailableCount: { type: 'number', description: 'Number of events available for export' },
    eventFieldCount: { type: 'number', description: 'Number of fields found in the results' },
    resultPreviewCount: { type: 'number', description: 'Number of rows in the latest preview' },
    scanCount: { type: 'number', description: 'Number of events scanned off disk' },
    runDuration: { type: 'number', description: 'Seconds the search took to complete' },
    priority: { type: 'number', description: 'Search priority between 0 and 10' },
    earliestTime: { type: 'string', description: 'Earliest time bound of the job' },
    latestTime: { type: 'string', description: 'Latest time bound of the job' },
    searchEarliestTime: {
      type: 'number',
      description: 'Earliest time as specified in the search command, as an epoch timestamp',
    },
    searchLatestTime: {
      type: 'number',
      description: 'Latest time as specified in the search command, as an epoch timestamp',
    },
    savedSearches: {
      type: 'json',
      description:
        'Saved searches ([{name, id, author, updated, search, description, disabled, isScheduled, cronSchedule, alertType}])',
    },
    name: { type: 'string', description: 'Saved search name' },
    id: { type: 'string', description: 'Fully qualified REST URI of the resource' },
    author: { type: 'string', description: 'Owner of the saved search' },
    updated: { type: 'string', description: 'Last update timestamp' },
    search: { type: 'string', description: 'SPL the saved search runs' },
    qualifiedSearch: { type: 'string', description: 'Exact search string the scheduler runs' },
    description: { type: 'string', description: 'Saved search description' },
    disabled: { type: 'boolean', description: 'Whether the saved search is disabled' },
    isScheduled: { type: 'boolean', description: 'Whether the search runs on a schedule' },
    isVisible: { type: 'boolean', description: 'Whether the search is listed as visible' },
    cronSchedule: { type: 'string', description: 'Cron schedule for the search' },
    nextScheduledTime: { type: 'string', description: 'Next scheduled run time' },
    alertType: { type: 'string', description: 'Alert condition type' },
    dispatchEarliestTime: { type: 'string', description: 'Earliest time used when dispatching' },
    dispatchLatestTime: { type: 'string', description: 'Latest time used when dispatching' },
    alerts: {
      type: 'json',
      description:
        'Saved searches with currently triggered alerts ([{name, id, updated, triggeredAlertCount}])',
    },
    firedAlerts: {
      type: 'json',
      description:
        'Triggered instances of an alert ([{name, savedSearchName, alertType, severity, sid, triggerTime}])',
    },
    indexes: {
      type: 'json',
      description:
        'Indexes configured on the instance ([{name, datatype, disabled, totalEventCount, currentDBSizeMB, maxTotalDataSizeMB, minTime, maxTime}])',
    },
    apps: {
      type: 'json',
      description: 'Apps installed on the instance (name, label, version, author, disabled)',
    },
    total: {
      type: 'number',
      description:
        'Total number of entries matching a list request, from the response paging envelope. Compare with offset to decide whether another page remains.',
    },
    offset: {
      type: 'number',
      description: 'Offset of the first entry in the returned page, from the paging envelope',
    },
  },
}

export const SplunkBlockMeta = {
  tags: ['monitoring', 'data-analytics'],
  url: 'https://www.splunk.com',
  skills: [
    {
      name: 'search-splunk-logs',
      description: 'Answer a question about production behavior by running an SPL search.',
      content:
        '# Search Splunk Logs\n\nTurn a question about production into an SPL search and answer from the rows.\n\n## Steps\n1. Write a single SPL search scoped to one index and a bounded time range (for example `index=main error earliest=-1h`).\n2. Run the run search operation, which executes the search synchronously and returns the rows in one call.\n3. Read resultCount and results to gather the evidence.\n4. Summarize what the rows show, quoting the fields that matter.\n\n## Notes\nRun search buffers its whole result set in one response and cannot page. For a larger result set, create a search job and page through get search results with offset.\n\n## Output\nReturn the SPL that was run, the row count, and a short answer to the question.',
    },
    {
      name: 'long-running-search-job',
      description: 'Dispatch a long Splunk search, poll it to completion, then page the results.',
      content:
        '# Long-Running Search Job\n\nRun a search that is too slow for a synchronous call.\n\n## Steps\n1. Create a search job with the SPL and time range. Keep the returned sid.\n2. Poll get search job with that sid until dispatchState is DONE. Check isFailed and isZombie on each poll and stop if either is true.\n3. Fetch results with get search results, paging with count and offset until the rows are exhausted.\n4. Cancel the job when abandoning it early so the result cache is released.\n\n## Output\nReport the sid, the final dispatch state, the number of rows fetched, and the summarized findings.',
    },
    {
      name: 'triage-fired-alerts',
      description: 'Pull currently firing Splunk alerts and turn them into a triage summary.',
      content:
        '# Triage Fired Alerts\n\nTurn unexpired Splunk alerts into an actionable summary.\n\n## Steps\n1. List fired alerts to get every saved search with triggered alerts and its trigger count.\n2. For the noisiest saved searches, get fired alerts by name to read the individual instances with their severity, sid, and trigger time.\n3. Group the instances by saved search and severity, and rank by trigger count.\n4. Have an agent write a short triage note naming what is firing, how often, and what to look at first.\n\n## Output\nReturn the ranked alert list with trigger counts and the triage note.',
    },
    {
      name: 'run-saved-search',
      description: 'Dispatch an existing Splunk saved search and report its results.',
      content:
        '# Run Saved Search\n\nExecute a saved search that already encodes the right SPL.\n\n## Steps\n1. List saved searches, or get one by name, to confirm the search exists and read its SPL and schedule.\n2. Dispatch the saved search. Set trigger actions only when the alert actions should really fire.\n3. Poll get search job with the returned sid until the job is done.\n4. Fetch and summarize the results.\n\n## Output\nReturn the saved search name, the sid of the dispatched job, and a summary of the rows it produced.',
    },
    {
      name: 'index-capacity-report',
      description: 'Report on Splunk index size, retention, and event volume.',
      content:
        '# Index Capacity Report\n\nCheck which indexes are close to their limits.\n\n## Steps\n1. List indexes to read name, datatype, totalEventCount, currentDBSizeMB, maxTotalDataSizeMB, and frozenTimePeriodInSecs.\n2. Compute how full each index is against its maximum data size.\n3. Flag indexes above a threshold, and any whose retention window is shorter than the team expects.\n4. Page with count and offset when the instance has more indexes than one page returns.\n\n## Output\nReturn a table of indexes with size, usage percentage, and retention, plus the flagged entries.',
    },
    {
      name: 'audit-saved-search-hygiene',
      description: 'Inventory Splunk saved searches and flag disabled or stale scheduled ones.',
      content:
        '# Audit Saved Search Hygiene\n\nFind saved searches that no longer earn their schedule.\n\n## Steps\n1. List saved searches, paging with count and offset until total is covered.\n2. Read disabled, isScheduled, cronSchedule, and nextScheduledTime on each entry.\n3. Flag scheduled searches that are disabled, searches with no next scheduled time, and duplicate SPL across entries.\n4. Write the cleanup candidates somewhere durable, such as a table or a file.\n\n## Output\nReturn the counts by category and the list of cleanup candidates with the reason each was flagged.',
    },
    {
      name: 'app-inventory-check',
      description: 'Inventory the apps installed on a Splunk instance and flag disabled ones.',
      content:
        '# App Inventory Check\n\nRecord what is installed on the Splunk instance.\n\n## Steps\n1. List apps to read name, label, version, author, disabled, and configured.\n2. Flag apps that are installed but disabled, and apps that are not configured.\n3. Compare the versions against the versions the team expects to be running.\n\n## Output\nReturn the app inventory with versions and the list of disabled or unconfigured apps.',
    },
  ],
  templates: [
    {
      icon: SplunkIcon,
      title: 'Splunk error spike triage',
      prompt:
        'Build a scheduled workflow that runs a Splunk SPL search for error spikes every 15 minutes, summarizes the top offending hosts and sourcetypes with an agent, and posts the triage summary to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SplunkIcon,
      title: 'Splunk alert to incident',
      prompt:
        'Create a scheduled workflow that polls Splunk fired alerts, deduplicates them by saved search, and opens a PagerDuty incident with the alert severity and the search ID attached.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'incident-response'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: SplunkIcon,
      title: 'Splunk security digest',
      prompt:
        'Build a scheduled daily workflow that dispatches a Splunk saved search for failed authentication attempts, waits for the job to finish, and emails a security digest with the top source IPs.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['security', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SplunkIcon,
      title: 'Splunk log export to tables',
      prompt:
        'Create a scheduled workflow that runs a Splunk search for the previous hour of transaction logs and writes the results into a Sim table for downstream reporting.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
    },
    {
      icon: SplunkIcon,
      title: 'Splunk index capacity watch',
      prompt:
        'Build a scheduled weekly workflow that lists Splunk indexes, flags any index close to its maximum data size or retention limit, and posts a capacity warning to the platform team in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SplunkIcon,
      title: 'Splunk saved search inventory',
      prompt:
        'Create a scheduled monthly workflow that lists every Splunk saved search, flags scheduled searches that have not run recently or are disabled, and writes a cleanup queue to a Sim table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: SplunkIcon,
      title: 'Splunk incident context agent',
      prompt:
        'Build an agent workflow that takes an incident description, runs targeted Splunk searches for the affected service, and returns a timeline of the relevant log events with the matching search ID.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'analysis'],
    },
    {
      icon: SplunkIcon,
      title: 'Splunk + Jira defect linking',
      prompt:
        'Create a scheduled workflow that runs a Splunk search for recurring application exceptions and opens or updates a Jira bug for each distinct stack trace with the event count attached.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'ticketing'],
      alsoIntegrations: ['jira'],
    },
  ],
} as const satisfies BlockMeta
