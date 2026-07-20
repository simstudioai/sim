import { FirecrawlIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta, SubBlockType } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { FirecrawlResponse } from '@/tools/firecrawl/types'

export const FirecrawlBlock: BlockConfig<FirecrawlResponse> = {
  type: 'firecrawl',
  name: 'Firecrawl',
  description: 'Scrape, search, crawl, map, and extract web data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Firecrawl into the workflow. Scrape pages, search the web, crawl entire sites, map URL structures, and extract structured data with AI.',
  docsLink: 'https://docs.sim.ai/integrations/firecrawl',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#181C1E',
  icon: FirecrawlIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Scrape', id: 'scrape' },
        { label: 'Batch Scrape', id: 'batch_scrape' },
        { label: 'Batch Scrape Status', id: 'batch_scrape_status' },
        { label: 'Search', id: 'search' },
        { label: 'Crawl', id: 'crawl' },
        { label: 'Crawl Status', id: 'crawl_status' },
        { label: 'Cancel Crawl', id: 'cancel_crawl' },
        { label: 'Map', id: 'map' },
        { label: 'Extract', id: 'extract' },
        { label: 'Extract Status', id: 'extract_status' },
        { label: 'Agent', id: 'agent' },
        { label: 'Parse Document', id: 'parse' },
        { label: 'Credit Usage', id: 'credit_usage' },
      ],
      value: () => 'scrape',
    },
    {
      id: 'fileUpload',
      title: 'Document',
      type: 'file-upload' as SubBlockType,
      canonicalParamId: 'file',
      acceptedTypes:
        'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/vnd.oasis.opendocument.text,application/rtf,text/rtf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/html',
      placeholder: 'Upload a document (PDF, DOCX, HTML, XLSX, etc.)',
      mode: 'basic',
      maxSize: 50,
      condition: {
        field: 'operation',
        value: 'parse',
      },
      required: true,
    },
    {
      id: 'fileReference',
      title: 'File Reference',
      type: 'short-input' as SubBlockType,
      canonicalParamId: 'file',
      placeholder: 'File reference from previous block',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'parse',
      },
      required: true,
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
        value: ['extract', 'batch_scrape'],
      },
      required: {
        field: 'operation',
        value: ['extract', 'batch_scrape'],
      },
    },
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      placeholder: 'Enter the job ID',
      condition: {
        field: 'operation',
        value: ['crawl_status', 'cancel_crawl', 'batch_scrape_status', 'extract_status'],
      },
      required: {
        field: 'operation',
        value: ['crawl_status', 'cancel_crawl', 'batch_scrape_status', 'extract_status'],
      },
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
        value: ['scrape', 'parse', 'batch_scrape'],
      },
    },
    {
      id: 'formats',
      title: 'Output Formats',
      type: 'long-input',
      placeholder: '["markdown", "html"]',
      condition: {
        field: 'operation',
        value: ['scrape', 'parse', 'batch_scrape'],
      },
    },
    {
      id: 'maxConcurrency',
      title: 'Max Concurrency',
      type: 'short-input',
      placeholder: 'Maximum number of concurrent scrapes',
      mode: 'advanced',
      condition: { field: 'operation', value: 'batch_scrape' },
    },
    {
      id: 'ignoreInvalidURLs',
      title: 'Ignore Invalid URLs',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'batch_scrape' },
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
        value: ['scrape', 'search', 'parse'],
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
      id: 'includeTags',
      title: 'Include Tags',
      type: 'long-input',
      placeholder: '["article", "main"]',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'parse',
      },
    },
    {
      id: 'excludeTags',
      title: 'Exclude Tags',
      type: 'long-input',
      placeholder: '["nav", "footer"]',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'parse',
      },
    },
    {
      id: 'parsers',
      title: 'Parsers',
      type: 'long-input',
      placeholder: '[{"type": "pdf", "mode": "auto"}]',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'parse',
      },
    },
    {
      id: 'removeBase64Images',
      title: 'Remove Base64 Images',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'parse',
      },
    },
    {
      id: 'blockAds',
      title: 'Block Ads',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'parse',
      },
    },
    {
      id: 'proxy',
      title: 'Proxy Mode',
      type: 'dropdown',
      options: [
        { id: 'basic', label: 'Basic' },
        { id: 'auto', label: 'Auto' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'parse',
      },
    },
    {
      id: 'zeroDataRetention',
      title: 'Zero Data Retention',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'parse',
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
      hideWhenHosted: true,
      condition: {
        field: 'operation',
        value: 'agent',
        not: true,
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Firecrawl API key',
      password: true,
      required: true,
      condition: {
        field: 'operation',
        value: 'agent',
      },
    },
  ],
  tools: {
    access: [
      'firecrawl_scrape',
      'firecrawl_batch_scrape',
      'firecrawl_batch_scrape_status',
      'firecrawl_search',
      'firecrawl_crawl',
      'firecrawl_crawl_status',
      'firecrawl_cancel_crawl',
      'firecrawl_map',
      'firecrawl_extract',
      'firecrawl_extract_status',
      'firecrawl_agent',
      'firecrawl_parse',
      'firecrawl_credit_usage',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'scrape':
            return 'firecrawl_scrape'
          case 'batch_scrape':
            return 'firecrawl_batch_scrape'
          case 'batch_scrape_status':
            return 'firecrawl_batch_scrape_status'
          case 'search':
            return 'firecrawl_search'
          case 'crawl':
            return 'firecrawl_crawl'
          case 'crawl_status':
            return 'firecrawl_crawl_status'
          case 'cancel_crawl':
            return 'firecrawl_cancel_crawl'
          case 'map':
            return 'firecrawl_map'
          case 'extract':
            return 'firecrawl_extract'
          case 'extract_status':
            return 'firecrawl_extract_status'
          case 'agent':
            return 'firecrawl_agent'
          case 'parse':
            return 'firecrawl_parse'
          case 'credit_usage':
            return 'firecrawl_credit_usage'
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
          jobId,
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

          case 'parse': {
            const file = normalizeFileInput(params.file, { single: true })
            if (!file) {
              throw new Error('A document file is required for the parse operation')
            }
            result.file = file
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
            if (onlyMainContent != null) result.onlyMainContent = onlyMainContent
            if (timeout) result.timeout = Number.parseInt(timeout)

            const parseStringArray = (value: unknown): string[] | undefined => {
              if (Array.isArray(value)) return value as string[]
              if (typeof value === 'string' && value.trim() !== '') {
                try {
                  const parsed = JSON.parse(value)
                  return Array.isArray(parsed) ? parsed : undefined
                } catch {
                  return undefined
                }
              }
              return undefined
            }

            const includeTagsParsed = parseStringArray(params.includeTags)
            if (includeTagsParsed) result.includeTags = includeTagsParsed

            const excludeTagsParsed = parseStringArray(params.excludeTags)
            if (excludeTagsParsed) result.excludeTags = excludeTagsParsed

            if (params.parsers) {
              if (Array.isArray(params.parsers)) {
                result.parsers = params.parsers
              } else if (typeof params.parsers === 'string' && params.parsers.trim() !== '') {
                try {
                  const parsed = JSON.parse(params.parsers)
                  if (Array.isArray(parsed)) result.parsers = parsed
                } catch {
                  // Skip invalid parsers config
                }
              }
            }

            if (params.removeBase64Images != null)
              result.removeBase64Images = params.removeBase64Images
            if (params.blockAds != null) result.blockAds = params.blockAds
            if (params.proxy) result.proxy = params.proxy
            if (params.zeroDataRetention != null)
              result.zeroDataRetention = params.zeroDataRetention
            break
          }

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

          case 'batch_scrape':
            if (urls) {
              if (Array.isArray(urls)) {
                result.urls = urls
              } else if (typeof urls === 'string') {
                try {
                  const parsed = JSON.parse(urls)
                  result.urls = Array.isArray(parsed) ? parsed : [parsed]
                } catch {
                  result.urls = urls
                }
              }
            }
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
            if (onlyMainContent != null) result.onlyMainContent = onlyMainContent
            if (params.maxConcurrency != null && params.maxConcurrency !== '') {
              result.maxConcurrency = Number.parseInt(String(params.maxConcurrency))
            }
            if (params.ignoreInvalidURLs != null) {
              result.ignoreInvalidURLs = params.ignoreInvalidURLs
            }
            break

          case 'crawl_status':
          case 'cancel_crawl':
          case 'batch_scrape_status':
          case 'extract_status':
            if (jobId) result.jobId = jobId
            break

          case 'credit_usage':
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
    urls: { type: 'json', description: 'Array of URLs for extraction or batch scraping' },
    jobId: { type: 'string', description: 'Job ID for status/cancel operations' },
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
    file: { type: 'json', description: 'Document input (file upload or file reference)' },
    includeTags: { type: 'json', description: 'HTML tags to include during parsing' },
    excludeTags: { type: 'json', description: 'HTML tags to exclude during parsing' },
    parsers: { type: 'json', description: 'Parser configuration (e.g., [{"type": "pdf"}])' },
    removeBase64Images: { type: 'boolean', description: 'Remove base64 images, keep alt text' },
    blockAds: { type: 'boolean', description: 'Block ads and popups during parsing' },
    proxy: { type: 'string', description: 'Proxy mode (basic or auto)' },
    zeroDataRetention: { type: 'boolean', description: 'Enable zero data retention' },
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
    pages: { type: 'json', description: 'Crawled or batch-scraped pages data' },
    total: { type: 'number', description: 'Total pages found' },
    completed: { type: 'number', description: 'Number of pages completed' },
    creditsUsed: { type: 'number', description: 'Credits consumed by the job' },
    next: { type: 'string', description: 'URL to retrieve the next page of results' },
    invalidURLs: { type: 'json', description: 'URLs skipped because they were invalid' },
    // Map output
    success: { type: 'boolean', description: 'Operation success status' },
    links: { type: 'json', description: 'Discovered URLs array' },
    // Extract output
    sources: { type: 'json', description: 'Data sources array' },
    tokensUsed: { type: 'number', description: 'Tokens consumed by the extract job' },
    jobId: { type: 'string', description: 'Job ID for the started operation' },
    status: { type: 'string', description: 'Job status' },
    expiresAt: { type: 'string', description: 'Result expiration timestamp' },
    remainingCredits: { type: 'number', description: 'Credits remaining for the team' },
    planCredits: { type: 'number', description: 'Credits allocated in the current plan' },
    billingPeriodStart: { type: 'string', description: 'Start of the current billing period' },
    billingPeriodEnd: { type: 'string', description: 'End of the current billing period' },
    // Parse output
    summary: { type: 'string', description: 'Generated summary of the parsed document' },
    rawHtml: { type: 'string', description: 'Unprocessed raw HTML from the parsed document' },
    screenshot: { type: 'string', description: 'Screenshot URL or base64 (when requested)' },
  },
}

export const FirecrawlBlockMeta = {
  tags: ['web-scraping', 'automation'],
  url: 'https://www.firecrawl.dev',
  templates: [
    {
      icon: FirecrawlIcon,
      title: 'Firecrawl SEO brief generator',
      prompt:
        'Build a workflow that takes a target keyword, uses Firecrawl to scrape the top 10 ranking pages, analyzes their content structure and subtopics, then generates a detailed content brief with outline, word count target, questions to answer, and internal linking suggestions.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'research'],
    },
    {
      icon: FirecrawlIcon,
      title: 'Firecrawl competitive intel monitor',
      prompt:
        'Build a scheduled workflow that scrapes competitor websites, pricing pages, and changelog pages weekly using Firecrawl, compares against previous snapshots, summarizes any changes, logs them to a tracking table, and sends a Slack alert for major updates.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['founder', 'product', 'monitoring', 'research'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: FirecrawlIcon,
      title: 'Firecrawl competitor site monitor',
      prompt:
        'Build a scheduled workflow that uses Firecrawl to scrape competitor pricing, product, and changelog pages weekly, diffs against the prior snapshot, and posts changes to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: FirecrawlIcon,
      title: 'Firecrawl SEO content brief',
      prompt:
        'Create a workflow that takes a target keyword, scrapes the top-10 ranking pages with Firecrawl, analyzes structure and subtopics, and writes a content brief file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: FirecrawlIcon,
      title: 'Firecrawl knowledge-base builder',
      prompt:
        'Build a workflow that crawls a documentation site with Firecrawl, chunks and embeds the pages, and upserts them into a knowledge base for an answering agent.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'sync'],
    },
    {
      icon: FirecrawlIcon,
      title: 'Firecrawl + Exa research stack',
      prompt:
        'Create an agent that uses Exa to find authoritative URLs on a topic, scrapes each with Firecrawl, and produces a structured research brief with citations.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research'],
      alsoIntegrations: ['exa'],
    },
    {
      icon: FirecrawlIcon,
      title: 'Firecrawl product-launch detector',
      prompt:
        'Build a scheduled workflow that crawls competitor blogs and product pages with Firecrawl daily, classifies posts as product launches, and posts notable launches to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'scrape-page-to-markdown',
      description:
        'Scrape a single URL with Firecrawl and return clean main-content markdown for an agent to read.',
      content:
        '# Scrape Page to Markdown\n\nUse Firecrawl to fetch a web page as clean, LLM-ready markdown.\n\n## Steps\n1. Use the Scrape operation on the target URL.\n2. Enable Only Main Content to strip navigation, ads, and footers; set a Wait For delay if the page renders content with JavaScript.\n3. Return the markdown output and capture page metadata (title, description).\n\n## Output\nReturn the page markdown plus key metadata. If the page failed to load or returned empty content, report that instead of fabricating text.',
    },
    {
      name: 'extract-structured-data',
      description:
        'Pull structured fields from one or more URLs using Firecrawl Extract with a prompt or schema.',
      content:
        '# Extract Structured Data\n\nUse Firecrawl to extract specific fields from web pages.\n\n## Steps\n1. Use the Extract operation with the list of target URLs.\n2. Provide a clear extraction prompt describing exactly what to pull (for example product name, price, and description).\n3. Run the extraction and read the structured data from the response.\n\n## Output\nReturn the extracted records as structured JSON. List the source URLs and flag any URL that yielded no data.',
    },
    {
      name: 'crawl-site',
      description:
        'Crawl an entire site or section with Firecrawl and return the page content for indexing or analysis.',
      content:
        '# Crawl Site\n\nUse Firecrawl to traverse a site and collect its pages.\n\n## Steps\n1. Use the Crawl operation on the root URL, setting a sensible page Limit to control cost.\n2. Enable Only Main Content so each page comes back as clean markdown.\n3. Collect the crawled pages and their URLs from the response.\n\n## Output\nReturn the list of crawled pages with their URL and markdown content, plus the total page count. This output is ready to chunk and embed into a knowledge base.',
    },
    {
      name: 'research-with-search',
      description:
        'Run a web search with Firecrawl, then scrape the top results into a cited research brief.',
      content:
        '# Research With Search\n\nUse Firecrawl to gather and synthesize web sources on a topic.\n\n## Steps\n1. Use the Search operation with the research query and a result Limit.\n2. For the most relevant results, use Scrape to pull the full page markdown.\n3. Synthesize the findings into a brief, attributing each claim to its source URL.\n\n## Output\nReturn a structured research brief with key findings and a Sources list of the URLs used. Keep claims grounded in the scraped content.',
    },
  ],
} as const satisfies BlockMeta
