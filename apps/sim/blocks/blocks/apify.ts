import { ApifyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { RunActorResult } from '@/tools/apify/types'

export const ApifyBlock: BlockConfig<RunActorResult> = {
  type: 'apify',
  name: 'Apify',
  description: 'Run Apify actors and retrieve results',
  longDescription:
    'Integrate Apify into your workflow. Run any Apify actor with custom input and retrieve results. Supports both synchronous and asynchronous execution with automatic dataset fetching.',
  docsLink: 'https://docs.sim.ai/tools/apify',
  category: 'tools',
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
      required: true,
    },
    {
      id: 'input',
      title: 'Actor Input',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "startUrl": "https://example.com",\n  "maxPages": 10\n}',
      required: false,
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
    },
    {
      id: 'timeout',
      title: 'Timeout',
      type: 'short-input',
      placeholder: 'Timeout in seconds (e.g., 300 for 5 min)',
      required: false,
    },
    {
      id: 'build',
      title: 'Build',
      type: 'short-input',
      placeholder: 'Build version (e.g., "latest", "beta", "1.2.3")',
      required: false,
    },
    {
      id: 'waitForFinish',
      title: 'Wait For Finish',
      type: 'short-input',
      placeholder: 'Initial wait time in seconds (0-60)',
      required: false,
      condition: {
        field: 'operation',
        value: 'apify_run_actor_async',
      },
    },
    {
      id: 'itemLimit',
      title: 'Item Limit',
      type: 'short-input',
      placeholder: 'Max dataset items to fetch (1-250000)',
      required: false,
      condition: {
        field: 'operation',
        value: 'apify_run_actor_async',
      },
    },
  ],

  tools: {
    access: ['apify_run_actor_sync', 'apify_run_actor_async'],
    config: {
      tool: (params) => params.operation,
      params: (params: Record<string, any>) => {
        const { operation, ...rest } = params
        const result: Record<string, any> = {
          apiKey: rest.apiKey,
          actorId: rest.actorId,
        }

        if (rest.input) {
          result.input = rest.input
        }

        if (rest.memory) {
          result.memory = Number(rest.memory)
        }

        if (rest.timeout) {
          result.timeout = Number(rest.timeout)
        }

        if (rest.build) {
          result.build = rest.build
        }

        if (rest.waitForFinish) {
          result.waitForFinish = Number(rest.waitForFinish)
        }

        if (rest.itemLimit) {
          result.itemLimit = Number(rest.itemLimit)
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Apify API token' },
    actorId: { type: 'string', description: 'Actor ID or username/actor-name' },
    input: { type: 'string', description: 'Actor input as JSON string' },
    memory: { type: 'number', description: 'Memory in MB (128-32768)' },
    timeout: { type: 'number', description: 'Timeout in seconds' },
    build: { type: 'string', description: 'Actor build version' },
    waitForFinish: { type: 'number', description: 'Initial wait time in seconds' },
    itemLimit: { type: 'number', description: 'Max dataset items to fetch' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the actor run succeeded' },
    runId: { type: 'string', description: 'Apify run ID' },
    status: { type: 'string', description: 'Run status (SUCCEEDED, FAILED, etc.)' },
    datasetId: { type: 'string', description: 'Dataset ID containing results' },
    items: { type: 'json', description: 'Dataset items (if completed)' },
  },
}
