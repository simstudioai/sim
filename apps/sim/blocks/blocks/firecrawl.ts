import { FirecrawlIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { FirecrawlResponse } from '@/tools/firecrawl/types'

export const FirecrawlBlock: BlockConfig<FirecrawlResponse> = {
  type: 'firecrawl',
  name: 'Firecrawl',
  description: 'Scrape, search, crawl, map, and extract web data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Firecrawl into the workflow. Scrape pages, search the web, crawl entire sites, map URL structures, and extract structured data with AI.',
  docsLink: 'https://docs.sim.ai/tools/firecrawl',
  category: 'tools',
  bgColor: '#181C1E',
  icon: FirecrawlIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Scrape', id: 'scrape' },
        { label: 'Search', id: 'search' },
        { label: 'Crawl', id: 'crawl' },
        { label: 'Map', id: 'map' },
        { label: 'Extract', id: 'extract' },
        { label: 'Agent', id: 'agent' },
      ],
      value: () => 'scrape',
    },
    {
      id: 'url',
      title: 'Website URL',
      type: 'short-input',
      placeholder: 'Enter the website URL',
      condition: {
        field: 'operation',
        value: ['scrape', 'crawl', 'map'],
      },
      required: true,
    },
    {
      id: 'urls',
      title: 'URLs',
      type: 'long-input',
      placeholder: '["https://example.com/page1", "https://example.com/page2"]',
      condition: {
        field: 'operation',
        value: 'extract',
      },
      required: true,
    },
    {
      id: 'prompt',
      title: 'Extraction Prompt',
      type: 'long-input',
      placeholder:
        'Describe what data to extract (e.g., "Extract product names, prices, and descriptions")',
      condition: {
        field: 'operation',
        value: 'extract',
      },
    },
    {
      id: 'agentPrompt',
      title: 'Agent Prompt',
      type: 'long-input',
      placeholder:
        'Describe what data to find and extract (e.g., "Find the founders of Firecrawl and their backgrounds")',
      condition: {
        field: 'operation',
        value: 'agent',
      },
      required: true,
    },
    {
      id: 'agentUrls',
      title: 'Focus URLs',
      type: 'long-input',
      placeholder: '["https://example.com/page1", "https://example.com/page2"]',
      condition: {
        field: 'operation',
        value: 'agent',
      },
    },
    {
      id: 'schema',
      title: 'Output Schema',
      type: 'code',
      placeholder: 'Enter JSON schema...',
      language: 'json',
      condition: {
        field: 'operation',
        value: 'agent',
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert programmer specializing in creating JSON schemas for web data extraction.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON object should define the structure of data to extract from web pages.
Use standard JSON Schema properties (type, description, enum, items for arrays, etc.).

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1 - Company Information:
{
    "type": "object",
    "properties": {
        "company_name": {
            "type": "string",
            "description": "The name of the company"
        },
        "founders": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "role": { "type": "string" }
                }
            }
        }
    },
    "required": ["company_name"]
}

Example 2 - Product Data:
{
    "type": "object",
    "properties": {
        "products": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "price": { "type": "number" },
                    "description": { "type": "string" }
                }
            }
        }
    }
}
`,
        placeholder: 'Describe the data structure you want to extract...',
        generationType: 'json-schema',
      },
    },
    {
      id: 'maxCredits',
      title: 'Max Credits',
      type: 'short-input',
      placeholder: 'Maximum credits to spend',
      condition: {
        field: 'operation',
        value: 'agent',
      },
    },
    {
      id: 'strictConstrainToURLs',
      title: 'Strict URL Constraint',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'agent',
      },
    },
    {
      id: 'onlyMainContent',
      title: 'Only Main Content',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'formats',
      title: 'Output Formats',
      type: 'long-input',
      placeholder: '["markdown", "html"]',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'waitFor',
      title: 'Wait For (ms)',
      type: 'short-input',
      placeholder: '0',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'mobile',
      title: 'Mobile Mode',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'scrape',
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (ms)',
      type: 'short-input',
      placeholder: '60000',
      condition: {
        field: 'operation',
        value: ['scrape', 'search'],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: ['crawl', 'map', 'search'],
      },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter the search query',
      condition: {
        field: 'operation',
        value: 'search',
      },
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Firecrawl API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'firecrawl_scrape',
      'firecrawl_search',
      'firecrawl_crawl',
      'firecrawl_map',
      'firecrawl_extract',
      'firecrawl_agent',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'scrape':
            return 'firecrawl_scrape'
          case 'search':
            return 'firecrawl_search'
          case 'crawl':
            return 'firecrawl_crawl'
          case 'map':
            return 'firecrawl_map'
          case 'extract':
            return 'firecrawl_extract'
          case 'agent':
            return 'firecrawl_agent'
          default:
            return 'firecrawl_scrape'
        }
      },
      params: (params) => {
        const {
          operation,
          limit,
          urls,
          formats,
          timeout,
          waitFor,
          url,
          query,
          onlyMainContent,
          mobile,
          prompt,
          apiKey,
          agentPrompt,
          agentUrls,
          schema,
          maxCredits,
          strictConstrainToURLs,
        } = params

        const result: Record<string, any> = { apiKey }

        switch (operation) {
          case 'scrape':
            if (url) result.url = url
            if (formats) {
              if (Array.isArray(formats)) {
                result.formats = formats
              } else if (typeof formats === 'string') {
                try {
                  const parsed = JSON.parse(formats)
                  result.formats = Array.isArray(parsed) ? parsed : ['markdown']
                } catch {
                  result.formats = ['markdown']
                }
              }
            }
            if (timeout) result.timeout = Number.parseInt(timeout)
            if (waitFor) result.waitFor = Number.parseInt(waitFor)
            if (onlyMainContent != null) result.onlyMainContent = onlyMainContent
            if (mobile != null) result.mobile = mobile
            break

          case 'search':
            if (query) result.query = query
            if (timeout) result.timeout = Number.parseInt(timeout)
            if (limit) result.limit = Number.parseInt(limit)
            break

          case 'crawl':
            if (url) result.url = url
            if (limit) result.limit = Number.parseInt(limit)
            if (onlyMainContent != null) result.onlyMainContent = onlyMainContent
            break

          case 'map':
            if (url) result.url = url
            if (limit) result.limit = Number.parseInt(limit)
            break

          case 'extract':
            if (urls) {
              if (Array.isArray(urls)) {
                result.urls = urls
              } else if (typeof urls === 'string') {
                try {
                  const parsed = JSON.parse(urls)
                  result.urls = Array.isArray(parsed) ? parsed : [parsed]
                } catch {
                  result.urls = [urls]
                }
              }
            }
            if (prompt) result.prompt = prompt
            break

          case 'agent':
            if (agentPrompt) result.prompt = agentPrompt
            if (agentUrls) {
              if (Array.isArray(agentUrls)) {
                result.urls = agentUrls
              } else if (typeof agentUrls === 'string') {
                try {
                  const parsed = JSON.parse(agentUrls)
                  result.urls = Array.isArray(parsed) ? parsed : [parsed]
                } catch {
                  result.urls = [agentUrls]
                }
              }
            }
            if (schema) {
              if (typeof schema === 'object') {
                result.schema = schema
              } else if (typeof schema === 'string') {
                try {
                  result.schema = JSON.parse(schema)
                } catch {
                  // Skip invalid schema
                }
              }
            }
            if (maxCredits) result.maxCredits = Number.parseInt(maxCredits)
            if (strictConstrainToURLs != null) result.strictConstrainToURLs = strictConstrainToURLs
            break
        }

        return result
      },
    },
  },
  inputs: {
    apiKey: { type: 'string', description: 'Firecrawl API key' },
    operation: { type: 'string', description: 'Operation to perform' },
    url: { type: 'string', description: 'Target website URL' },
    urls: { type: 'json', description: 'Array of URLs for extraction' },
    query: { type: 'string', description: 'Search query terms' },
    prompt: { type: 'string', description: 'Extraction prompt' },
    limit: { type: 'string', description: 'Result/page limit' },
    formats: { type: 'json', description: 'Output formats array' },
    timeout: { type: 'number', description: 'Request timeout in ms' },
    waitFor: { type: 'number', description: 'Wait time before scraping in ms' },
    mobile: { type: 'boolean', description: 'Use mobile emulation' },
    onlyMainContent: { type: 'boolean', description: 'Extract only main content' },
    scrapeOptions: { type: 'json', description: 'Advanced scraping options' },
    agentPrompt: { type: 'string', description: 'Agent prompt describing data to extract' },
    agentUrls: { type: 'json', description: 'Optional URLs to focus the agent on' },
    schema: {
      type: 'json',
      description: 'JSON schema for structured output',
      schema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['object'],
            description: 'Must be "object" for a valid JSON Schema',
          },
          properties: {
            type: 'object',
            description: 'Object containing property definitions',
          },
          required: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of required property names',
          },
        },
        required: ['type', 'properties'],
      },
    },
    maxCredits: { type: 'number', description: 'Maximum credits to spend' },
    strictConstrainToURLs: { type: 'boolean', description: 'Limit agent to provided URLs only' },
  },
  outputs: {
    // Scrape output
    markdown: { type: 'string', description: 'Page content markdown' },
    html: { type: 'string', description: 'Raw HTML content' },
    metadata: { type: 'json', description: 'Page metadata' },
    // Search output
    data: { type: 'json', description: 'Search results or extracted data' },
    warning: { type: 'string', description: 'Warning messages' },
    // Crawl output
    pages: { type: 'json', description: 'Crawled pages data' },
    total: { type: 'number', description: 'Total pages found' },
    creditsUsed: { type: 'number', description: 'Credits consumed' },
    // Map output
    success: { type: 'boolean', description: 'Operation success status' },
    links: { type: 'json', description: 'Discovered URLs array' },
    // Extract output
    sources: { type: 'json', description: 'Data sources array' },
    // Agent output
    status: { type: 'string', description: 'Agent job status' },
    expiresAt: { type: 'string', description: 'Result expiration timestamp' },
  },
}
