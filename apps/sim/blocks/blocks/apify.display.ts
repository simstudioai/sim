import { ApifyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ApifyBlockDisplay = {
  type: 'apify',
  name: 'Apify',
  description: 'Run Apify actors and retrieve results',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ApifyIcon,
  longDescription:
    'Integrate Apify into your workflow. Run any Apify actor or saved task with custom input, fetch dataset items, and check run status. Supports both synchronous and asynchronous execution with automatic dataset fetching.',
  docsLink: 'https://docs.sim.ai/integrations/apify',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay

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
