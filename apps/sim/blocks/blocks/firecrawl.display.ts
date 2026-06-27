import { FirecrawlIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const FirecrawlBlockDisplay = {
  type: 'firecrawl',
  name: 'Firecrawl',
  description: 'Scrape, search, crawl, map, and extract web data',
  category: 'tools',
  bgColor: '#181C1E',
  icon: FirecrawlIcon,
  longDescription:
    'Integrate Firecrawl into the workflow. Scrape pages, search the web, crawl entire sites, map URL structures, and extract structured data with AI.',
  docsLink: 'https://docs.sim.ai/integrations/firecrawl',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay

export const FirecrawlBlockMeta = {
  tags: ['web-scraping', 'automation'],
  url: 'https://www.firecrawl.dev',
  templates: [
    {
      icon: FirecrawlIcon,
      title: 'SEO content brief generator',
      prompt:
        'Build a workflow that takes a target keyword, uses Firecrawl to scrape the top 10 ranking pages, analyzes their content structure and subtopics, then generates a detailed content brief with outline, word count target, questions to answer, and internal linking suggestions.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'research'],
    },
    {
      icon: FirecrawlIcon,
      title: 'Competitive intel monitor',
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
