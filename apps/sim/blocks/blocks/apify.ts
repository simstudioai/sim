import { ApifyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { RunActorResult } from '@/tools/apify/types'

const RUN_OPERATIONS = ['apify_run_actor_sync', 'apify_run_actor_async']
const RUN_OR_TASK_OPERATIONS = [...RUN_OPERATIONS, 'apify_run_task']

export const ApifyBlock: BlockConfig<RunActorResult> = {
  type: 'apify',
  name: 'Apify',
  description: 'Run Apify actors and retrieve results',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Apify into your workflow. Run any Apify actor or saved task with custom input, fetch dataset items, and check run status. Supports both synchronous and asynchronous execution with automatic dataset fetching.',
  docsLink: 'https://docs.sim.ai/tools/apify',
  category: 'tools',
  integrationType: IntegrationType.Search,
  tags: ['web-scraping', 'automation', 'data-analytics'],
  bgColor: '#E0E0E0',
  icon: ApifyIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Run Actor', id: 'apify_run_actor_sync' },
        { label: 'Run Actor (Async)', id: 'apify_run_actor_async' },
        { label: 'Run Task', id: 'apify_run_task' },
        { label: 'Get Dataset Items', id: 'apify_get_dataset_items' },
        { label: 'Get Run', id: 'apify_get_run' },
      ],
      value: () => 'apify_run_actor_sync',
    },
    {
      id: 'apiKey',
      title: 'Apify API Token',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Apify API token',
      required: true,
    },
    {
      id: 'actorId',
      title: 'Actor ID',
      type: 'short-input',
      placeholder: 'e.g., janedoe/my-actor or actor ID',
      condition: { field: 'operation', value: RUN_OPERATIONS },
      required: { field: 'operation', value: RUN_OPERATIONS },
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'e.g., janedoe/my-task or task ID',
      condition: { field: 'operation', value: 'apify_run_task' },
      required: { field: 'operation', value: 'apify_run_task' },
    },
    {
      id: 'datasetId',
      title: 'Dataset ID',
      type: 'short-input',
      placeholder: 'e.g., 9RnD3Pql2vGZkc5H5',
      condition: { field: 'operation', value: 'apify_get_dataset_items' },
      required: { field: 'operation', value: 'apify_get_dataset_items' },
    },
    {
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'e.g., HG7ML7M8z78YcAPEB',
      condition: { field: 'operation', value: 'apify_get_run' },
      required: { field: 'operation', value: 'apify_get_run' },
    },
    {
      id: 'input',
      title: 'Actor Input',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "startUrl": "https://example.com",\n  "maxPages": 10\n}',
      required: false,
      condition: { field: 'operation', value: RUN_OR_TASK_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON configuration object for an Apify actor based on the user's description.
Apify actors typically accept configuration for web scraping, automation, or data processing tasks.

Current input: {context}

Common Apify actor input patterns:
- Web scrapers: startUrls, maxPages, proxyConfiguration
- Crawlers: startUrls, maxRequestsPerCrawl, maxConcurrency
- Data processors: inputData, outputFormat, filters

Examples:
- "scrape 5 pages starting from example.com" ->
{"startUrls": [{"url": "https://example.com"}], "maxPages": 5}

- "crawl the site with proxy and limit to 100 requests" ->
{"startUrls": [{"url": "https://example.com"}], "maxRequestsPerCrawl": 100, "proxyConfiguration": {"useApifyProxy": true}}

- "extract product data with custom selectors" ->
{"startUrls": [{"url": "https://shop.example.com"}], "selectors": {"title": "h1.product-title", "price": ".price"}}

Return ONLY the valid JSON object - no explanations, no markdown.`,
        placeholder: 'Describe the actor configuration you need...',
        generationType: 'json-object',
      },
    },
    {
      id: 'memory',
      title: 'Memory (MB)',
      type: 'short-input',
      placeholder: 'Memory in MB (e.g., 1024 for 1GB, 2048 for 2GB)',
      required: false,
      mode: 'advanced',
      condition: { field: 'operation', value: RUN_OR_TASK_OPERATIONS },
    },
    {
      id: 'timeout',
      title: 'Timeout',
      type: 'short-input',
      placeholder: 'Timeout in seconds (e.g., 300 for 5 min)',
      required: false,
      mode: 'advanced',
      condition: { field: 'operation', value: RUN_OR_TASK_OPERATIONS },
    },
    {
      id: 'build',
      title: 'Build',
      type: 'short-input',
      placeholder: 'Build version (e.g., "latest", "beta", "1.2.3")',
      required: false,
      mode: 'advanced',
      condition: { field: 'operation', value: RUN_OR_TASK_OPERATIONS },
    },
    {
      id: 'waitForFinish',
      title: 'Wait For Finish',
      type: 'short-input',
      placeholder: 'Initial wait time in seconds (0-60)',
      required: false,
      mode: 'advanced',
      condition: { field: 'operation', value: 'apify_run_actor_async' },
    },
    {
      id: 'itemLimit',
      title: 'Item Limit',
      type: 'short-input',
      placeholder: 'Max dataset items to fetch (1-250000)',
      required: false,
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['apify_run_actor_async', 'apify_run_task', 'apify_get_dataset_items'],
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Number of items to skip (default 0)',
      required: false,
      mode: 'advanced',
      condition: { field: 'operation', value: 'apify_get_dataset_items' },
    },
    {
      id: 'fields',
      title: 'Fields',
      type: 'short-input',
      placeholder: 'Comma-separated fields (e.g., title,url,price)',
      required: false,
      mode: 'advanced',
      condition: { field: 'operation', value: 'apify_get_dataset_items' },
    },
  ],

  tools: {
    access: [
      'apify_run_actor_sync',
      'apify_run_actor_async',
      'apify_run_task',
      'apify_get_dataset_items',
      'apify_get_run',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params: Record<string, any>) => {
        const { operation, ...rest } = params
        const result: Record<string, any> = { apiKey: rest.apiKey }

        if (rest.actorId) result.actorId = rest.actorId
        if (rest.taskId) result.taskId = rest.taskId
        if (rest.datasetId) result.datasetId = rest.datasetId
        if (rest.runId) result.runId = rest.runId
        if (rest.input) result.input = rest.input
        if (rest.build) result.build = rest.build
        if (rest.fields) result.fields = rest.fields
        if (rest.memory) result.memory = Number(rest.memory)
        if (rest.timeout) result.timeout = Number(rest.timeout)
        if (rest.waitForFinish) result.waitForFinish = Number(rest.waitForFinish)
        if (rest.itemLimit) result.itemLimit = Number(rest.itemLimit)
        if (rest.offset !== undefined && rest.offset !== null && rest.offset !== '')
          result.offset = Number(rest.offset)

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Apify API token' },
    actorId: { type: 'string', description: 'Actor ID or username/actor-name' },
    taskId: { type: 'string', description: 'Task ID or username/task-name' },
    datasetId: { type: 'string', description: 'Dataset ID to read items from' },
    runId: { type: 'string', description: 'Actor run ID to fetch' },
    input: { type: 'string', description: 'Actor input as JSON string' },
    memory: { type: 'number', description: 'Memory in MB (128-32768)' },
    timeout: { type: 'number', description: 'Timeout in seconds' },
    build: { type: 'string', description: 'Actor build version' },
    waitForFinish: { type: 'number', description: 'Initial wait time in seconds' },
    itemLimit: { type: 'number', description: 'Max dataset items to fetch' },
    offset: { type: 'number', description: 'Number of items to skip' },
    fields: { type: 'string', description: 'Comma-separated fields to include' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    runId: { type: 'string', description: 'Apify run ID' },
    status: { type: 'string', description: 'Run status (SUCCEEDED, FAILED, etc.)' },
    datasetId: { type: 'string', description: 'Dataset ID containing results' },
    items: { type: 'json', description: 'Dataset items (if completed)' },
    count: { type: 'number', description: 'Number of items returned (Get Dataset Items)' },
    startedAt: { type: 'string', description: 'When the run started (Get Run)' },
    finishedAt: { type: 'string', description: 'When the run finished (Get Run)' },
  },
}
