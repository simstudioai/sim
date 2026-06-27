import { TavilyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const TavilyBlockDisplay = {
  type: 'tavily',
  name: 'Tavily',
  description: 'Search and extract information',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: TavilyIcon,
  longDescription:
    'Integrate Tavily into the workflow. Can search the web and extract content from specific URLs. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/tavily',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay

export const TavilyBlockMeta = {
  tags: ['web-scraping', 'enrichment'],
  url: 'https://tavily.com',
  templates: [
    {
      icon: TavilyIcon,
      title: 'Tavily research-augmented agent',
      prompt:
        'Create an agent that grounds every answer in fresh Tavily web search results, returns answers with inline citations, and saves long-form research to a knowledge base for re-use.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily competitive monitor',
      prompt:
        'Create a scheduled workflow that runs Tavily searches for competitor mentions weekly, scores each by relevance, logs the top hits to a tables-based competitive log, and posts highlights to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily research-augmented chat',
      prompt:
        'Build a chat agent that grounds each answer in fresh Tavily web search results, returns inline citations, and saves long-form answers to a knowledge base for re-use.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily news watcher',
      prompt:
        'Create a scheduled daily workflow that runs Tavily searches for topics I follow, summarizes the top hits with citations, and posts a digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily account refresher',
      prompt:
        'Build a workflow that walks accounts in the CRM, runs Tavily research on each for new funding, hiring, or product launches, and writes the digest back to the account record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily competitor mention log',
      prompt:
        'Create a scheduled workflow that runs Tavily searches for competitor mentions weekly, scores each by relevance, and writes a competitive log to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: TavilyIcon,
      title: 'Tavily URL content extractor',
      prompt:
        'Build a workflow that reads a table of article URLs, uses Tavily extract to pull the clean main content from each page, summarizes the key points with an agent, and writes the summary back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'web-scraping', 'automation'],
    },
  ],
  skills: [
    {
      name: 'answer-with-web-citations',
      description:
        'Search the web with Tavily and return a grounded answer with linked source citations.',
      content:
        '# Answer a Question with Web Citations\n\nGround an answer in fresh web results so it is current and verifiable.\n\n## Steps\n1. Use the Search operation with the question as the Search Query.\n2. Set Include Answer to Advanced, Search Depth to advanced, and Max Results to about 5 for good coverage.\n3. Pick the Topic (news or finance) when the question is time-sensitive, and set Time Range (day, week, month) to keep results recent.\n4. Use Include Domains or Exclude Domains to keep results on trusted sources.\n\n## Output\nReturn the synthesized answer followed by a numbered list of the source titles and URLs used to support it.',
    },
    {
      name: 'extract-article-content',
      description:
        'Pull clean main content from one or more URLs with Tavily Extract for summarization.',
      content:
        '# Extract Clean Article Content\n\nTurn a messy web page into clean text or markdown that an agent can summarize.\n\n## Steps\n1. Use the Extract Content operation and pass the page URL into the URL field.\n2. Set Extract Depth to advanced for content-heavy pages and choose Markdown or Text as the Format.\n3. Enable Include Images only if downstream steps need the media.\n4. Feed the extracted content to an agent to summarize the key points.\n\n## Output\nReturn the page title, source URL, and the cleaned content, plus any failed URLs so they can be retried.',
    },
    {
      name: 'crawl-site-section',
      description:
        'Crawl a website section with Tavily and gather page content matching path rules.',
      content:
        '# Crawl a Website Section\n\nWalk a site beginning at a root URL and collect content from matching pages.\n\n## Steps\n1. Use the Crawl Website operation with the root Website URL.\n2. Give natural-language Instructions describing what to collect (for example "gather all product documentation pages").\n3. Bound the crawl with Max Depth, Max Breadth, and Limit so it stays focused.\n4. Use Select Paths and Exclude Paths regex patterns (for example /docs/.* to include, /admin/.* to exclude) to target the right section.\n\n## Output\nReturn the crawled pages with their URLs and extracted content, ready to index into a knowledge base or summarize.',
    },
    {
      name: 'map-site-structure',
      description: 'Map a website URL structure with Tavily without extracting full page content.',
      content:
        '# Map a Website Structure\n\nDiscover the URL layout of a site quickly without pulling full page bodies.\n\n## Steps\n1. Use the Map Website operation with the root Website URL.\n2. Set Max Depth and Max Breadth to control how far the mapper explores.\n3. Apply Select Paths or Exclude Paths regex patterns to focus on the sections you care about.\n4. Toggle Allow External Links only if you want links that leave the root domain.\n\n## Output\nReturn the discovered list of URLs so you can pick targets for a later crawl or extract pass.',
    },
  ],
} as const satisfies BlockMeta
