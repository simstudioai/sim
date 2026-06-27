import { BrightDataIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const BrightDataBlockDisplay = {
  type: 'brightdata',
  name: 'Bright Data',
  description: 'Scrape websites, search engines, and extract structured data',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: BrightDataIcon,
  longDescription:
    'Integrate Bright Data into the workflow. Scrape any URL with Web Unlocker, search Google and other engines with SERP API, discover web content ranked by intent, or trigger pre-built scrapers for structured data extraction.',
  docsLink: 'https://docs.sim.ai/integrations/brightdata',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay

export const BrightDataBlockMeta = {
  tags: ['web-scraping', 'automation'],
  url: 'https://brightdata.com',
  templates: [
    {
      icon: BrightDataIcon,
      title: 'Bright Data scraper orchestrator',
      prompt:
        'Build a workflow that uses Bright Data unblockers to scrape geo-restricted competitor pages, captures the data daily, and writes to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'monitoring'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data competitor pricing',
      prompt:
        'Create a workflow that uses Bright Data to track competitor pricing across regions, captures geo-priced data, and posts notable price changes to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data SERP collector',
      prompt:
        'Build a scheduled workflow that uses Bright Data SERP scraping to capture rankings for tracked keywords across regions, and writes the results to an SEO scoreboard.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data review collector',
      prompt:
        'Create a workflow that uses Bright Data to scrape product reviews across geos, classifies sentiment, and writes findings into a product-feedback table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['product', 'analysis'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data localization checker',
      prompt:
        'Build a scheduled workflow that uses Bright Data geo-targeted browsing to verify the brand’s site renders correctly in tracked regions, and writes findings to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data brand mention search',
      prompt:
        'Create a workflow that uses Bright Data to scrape mentions of the brand across global forums and review sites, writes mentions into a tracking table, and pings on spikes.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrightDataIcon,
      title: 'Bright Data inventory tracker',
      prompt:
        'Build a scheduled workflow that uses Bright Data to track competitor stock availability across regions, writes the data, and pings on low-stock signals indicating shifts.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'research'],
    },
  ],
  skills: [
    {
      name: 'scrape-page-content',
      description:
        'Fetch the content of a single web page through Bright Data Web Unlocker, bypassing bot blocks and geo-restrictions. Use to read a page an agent cannot otherwise access.',
      content:
        '# Scrape Page Content\n\nRetrieve a page that is normally blocked or geo-restricted.\n\n## Steps\n1. Use Scrape URL with the target URL and your unlocker zone (e.g. web_unlocker1).\n2. Choose the format: Raw HTML for full markup, or JSON for a parsed response.\n3. Set the Country code when the page differs by region.\n4. Run it and read the returned content and HTTP status code.\n\n## Output\nReturn the cleaned page content (text or relevant HTML) and the status code. If the status indicates a block or error, report it and suggest a different zone or country rather than returning empty content.',
    },
    {
      name: 'search-the-web',
      description:
        'Run a search-engine query through Bright Data SERP API and return ranked results. Use for keyword research, competitive monitoring, or grounding an answer in fresh results.',
      content:
        '# Search The Web\n\nGet structured search results for a query.\n\n## Steps\n1. Use SERP Search with the query and your SERP zone.\n2. Pick the search engine (Google, Bing, DuckDuckGo, or Yandex) and set country/language for localized results.\n3. Set the number of results to the amount you need.\n4. Read the results array (title, URL, snippet, rank).\n\n## Output\nReturn the ranked results as a list with title, URL, and snippet. Summarize the top findings for the user, and note the engine, country, and query used so the result is reproducible.',
    },
    {
      name: 'discover-pages-by-intent',
      description:
        'Find web pages that match a described intent using Bright Data Discover, optionally pulling page content. Use to gather sources on a topic without crafting exact queries.',
      content:
        '# Discover Pages By Intent\n\nFind relevant pages from a natural-language description.\n\n## Steps\n1. Use Discover with a search query and an Intent describing what you actually want (e.g. "official pricing pages and recent change notes").\n2. Set the number of results, country, and language as needed.\n3. Enable Include Page Content and choose Markdown or JSON when you want the page bodies, not just links.\n\n## Output\nReturn the discovered pages ranked by relevance with URL, title, and (if requested) extracted content. Summarize what was found and flag any low-relevance results so they can be filtered out.',
    },
    {
      name: 'run-dataset-scraper',
      description:
        'Trigger a Bright Data pre-built dataset scraper for structured extraction across many URLs and retrieve the results. Use for bulk structured data from sites like e-commerce or social.',
      content:
        '# Run Dataset Scraper\n\nExtract structured records across many URLs with a pre-built scraper.\n\n## Steps\n1. Identify the dataset scraper id for the target site (e.g. gd_...).\n2. For small batches (up to 20 URLs), use Sync Scrape to get results back inline; choose JSON, NDJSON, or CSV.\n3. For larger jobs, use Scrape Dataset, which returns a snapshot id.\n4. Poll Snapshot Status until it is ready, then use Download Snapshot to fetch the data. Use Cancel Snapshot to abort a job that is no longer needed.\n\n## Output\nReturn the structured records (or the snapshot id and status for async jobs). For async runs, report progress and only return data once the snapshot is complete.',
    },
  ],
} as const satisfies BlockMeta
