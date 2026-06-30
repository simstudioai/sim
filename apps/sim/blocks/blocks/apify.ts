import { ApifyIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
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
  docsLink: 'https://docs.sim.ai/integrations/apify',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#FFFFFF',
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

export const ApifyBlockMeta = {
  tags: ['web-scraping', 'automation', 'data-analytics'],
  url: 'https://apify.com',
  templates: [
    {
      icon: ApifyIcon,
      title: 'Apify scraper orchestrator',
      prompt:
        'Build a workflow that triggers Apify scrapers on a schedule, captures the output, transforms into structured rows, and writes them to a downstream Sim table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'sync'],
    },
    {
      icon: ApifyIcon,
      title: 'Apify lead-list builder',
      prompt:
        'Create a workflow that runs an Apify scraper on a target site, enriches each row with Clay, and writes the enriched lead list into HubSpot.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['clay', 'hubspot'],
    },
    {
      icon: ApifyIcon,
      title: 'Apify monitor digest',
      prompt:
        'Build a scheduled workflow that watches an Apify actor’s runs for failures, captures error patterns, and posts a digest to engineering Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ApifyIcon,
      title: 'Apify ecommerce price tracker',
      prompt:
        'Create a workflow that uses Apify scrapers to capture competitor pricing daily, writes the price history to a table, and posts price-drop alerts to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ApifyIcon,
      title: 'Apify event-data collector',
      prompt:
        'Build a workflow that uses Apify to scrape event sites — speakers, agendas, sponsors — and writes the data into a target-events research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: ApifyIcon,
      title: 'Apify directory scraper',
      prompt:
        'Create a workflow that runs an Apify directory scraper, captures business listings, enriches via Hunter or Apollo, and writes the prospect list to a CRM-ready table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['apollo'],
    },
    {
      icon: ApifyIcon,
      title: 'Apify job-listing monitor',
      prompt:
        'Build a scheduled workflow that uses Apify to scrape job sites for tracked companies, flags new role types, and writes intel into a sales-research table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'scrape-site-to-table',
      description:
        'Run an Apify actor to scrape a target website and write the extracted rows into a structured table. Use for one-off or recurring data extraction jobs.',
      content:
        '# Scrape Site to Table\n\nRun an Apify actor against a target site and load the results into a clean table.\n\n## Steps\n1. Pick the actor or saved task (e.g. a web scraper) and assemble its JSON input — start URLs, page or request limits, and proxy settings.\n2. Run the actor synchronously for small jobs, or asynchronously and poll Get Run for larger crawls.\n3. Once the run status is SUCCEEDED, fetch the dataset items, selecting only the fields you need.\n4. Normalize each item into consistent columns and write the rows to the destination table.\n\n## Output\nReport the run ID, final status, and row count. If the run failed, surface the error and the actor input that produced it so it can be retried.',
    },
    {
      name: 'monitor-prices',
      description:
        'Use an Apify scraper to capture competitor or product prices on a schedule, track history, and alert on changes. Use for price and stock monitoring.',
      content:
        '# Monitor Prices\n\nTrack pricing on target product pages over time and flag meaningful changes.\n\n## Steps\n1. Run the scraping actor with the product or category URLs to watch.\n2. From the dataset, extract product name, price, currency, and stock status for each item.\n3. Compare each price against the last recorded value for that product.\n4. Append the new snapshot to a price-history table.\n\n## Output\nList any products whose price dropped, rose, or went out of stock, with old and new values. If nothing changed, say so briefly.',
    },
    {
      name: 'build-lead-list',
      description:
        'Run an Apify directory or maps scraper to collect business listings and produce a deduplicated, CRM-ready lead list. Use for prospecting and lead generation.',
      content:
        '# Build Lead List\n\nCollect business listings from a directory and turn them into a usable prospect list.\n\n## Steps\n1. Run the directory or maps scraper actor with the search terms, location, and result limit.\n2. Fetch the dataset and pull company name, website, phone, email, and address for each listing.\n3. Drop entries missing the fields you require, then deduplicate by domain or phone.\n4. Write the cleaned rows to a lead table ready for enrichment or CRM import.\n\n## Output\nReport total listings scraped, how many passed filtering, and how many duplicates were removed.',
    },
    {
      name: 'collect-content-for-knowledge-base',
      description:
        'Use an Apify crawler to extract article or documentation text from a site and prepare it for ingestion into a knowledge base or RAG pipeline.',
      content:
        '# Collect Content for Knowledge Base\n\nCrawl a content site and gather clean text for downstream ingestion.\n\n## Steps\n1. Run the crawler actor with the start URLs and a request limit, scoped to the relevant section of the site.\n2. Fetch dataset items and extract title, URL, and main body text for each page.\n3. Strip navigation, boilerplate, and empty pages.\n4. Hand the cleaned documents to the knowledge base for chunking and indexing.\n\n## Output\nReport the number of pages crawled and ingested, and list any URLs that failed or returned no usable text.',
    },
  ],
} as const satisfies BlockMeta
