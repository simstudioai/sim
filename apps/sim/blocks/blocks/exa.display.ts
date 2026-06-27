import { ExaAIIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ExaBlockDisplay = {
  type: 'exa',
  name: 'Exa',
  description: 'Search with Exa AI',
  category: 'tools',
  bgColor: '#1F40ED',
  icon: ExaAIIcon,
  iconColor: '#1F40ED',
  longDescription:
    'Integrate Exa into the workflow. Can search, get contents, find similar links, answer a question, and perform research.',
  docsLink: 'https://docs.sim.ai/integrations/exa',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay

export const ExaBlockMeta = {
  tags: ['web-scraping'],
  url: 'https://exa.ai',
  templates: [
    {
      icon: ExaAIIcon,
      title: 'Exa company intel agent',
      prompt:
        'Build an agent that takes a company name, uses Exa neural search to find recent product updates, funding news, and competitor mentions, and writes a one-page intel brief.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa knowledge crawler',
      prompt:
        'Build a workflow that uses Exa to find authoritative URLs on a topic, scrapes each one, chunks the content, and upserts it into a knowledge base so the agent can answer with citations.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa neural research agent',
      prompt:
        'Build an agent that uses Exa neural search to find authoritative sources on a topic, scrapes them, and produces a structured research brief with citations.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa similar-page finder',
      prompt:
        'Create a workflow that takes a URL, runs Exa similar-page search to find related authoritative sources, and writes the discovery list to a research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa daily research digest',
      prompt:
        'Build a scheduled workflow that runs Exa searches on tracked topics each morning, summarizes top hits with citations, and emails the user a research digest.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa investment research helper',
      prompt:
        'Create an agent that uses Exa to deep-research a ticker, finds recent material developments, summarizes with citations, and writes the brief to a finance research file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'research'],
    },
    {
      icon: ExaAIIcon,
      title: 'Exa competitor news monitor',
      prompt:
        'Build a scheduled daily workflow that runs Exa search for fresh news about my competitors, gets the page contents and finds similar coverage, summarizes the notable moves with citations, and posts a digest to the team Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'search-the-web-with-exa',
      description:
        'Run an Exa neural or keyword search to find high-quality web sources on a topic.',
      content:
        '# Search the Web with Exa\n\nFind authoritative web pages on a topic using Exa AI search.\n\n## Steps\n1. Use the Search operation with a clear query. Pick the search type — neural for meaning-based discovery, keyword for exact terms, or auto to let Exa decide.\n2. Narrow results with include/exclude domains, a category filter (research paper, news article, company, GitHub), and published-date bounds for recency.\n3. Enable include-text or include-summary so each result comes back with usable content rather than just a link.\n\n## Output\nReturn the top results with title, URL, published date, and the text or summary. Note which filters were applied so the search can be tightened or broadened.',
    },
    {
      name: 'answer-question-with-citations',
      description: 'Use Exa Answer to get a direct, sourced answer to a factual question.',
      content:
        '# Answer Question with Citations\n\nGet a grounded answer to a question with supporting sources via Exa.\n\n## Steps\n1. Use the Answer operation and pass the question in natural language.\n2. Enable include-text when you want the supporting passages, not just the citation URLs.\n3. Review the citations to confirm the answer is well-supported before relying on it.\n\n## Output\nReturn the answer text plus its citations (titles and URLs). If the citations are weak or conflicting, say so and recommend a follow-up search.',
    },
    {
      name: 'extract-page-contents',
      description: 'Use Exa Get Contents to pull clean text and summaries from a set of URLs.',
      content:
        '# Extract Page Contents\n\nRetrieve readable content from specific web pages using Exa.\n\n## Steps\n1. Use the Get Contents operation with the target URLs (comma-separated).\n2. Enable include-text for full content, and supply a summary query to get a focused summary tailored to what you need.\n3. To pull deeper context from a site, set a subpage count and target keywords (e.g., docs, pricing, about).\n\n## Output\nReturn each URL with its extracted text or summary and any highlights. Flag any URL that could not be crawled.',
    },
    {
      name: 'find-similar-pages',
      description: 'Use Exa Find Similar Links to discover pages related to a known URL.',
      content:
        '# Find Similar Pages\n\nDiscover sources similar to a reference page using Exa.\n\n## Steps\n1. Use the Find Similar Links operation with the source URL.\n2. Set the number of results and enable exclude-source-domain so you get genuinely new sources, not more pages from the same site.\n3. Apply a category filter or include/exclude domains to keep the discovery on-target, and enable include-text or include-summary for context.\n\n## Output\nReturn the similar pages with title, URL, and a snippet or summary, ordered by relevance. Note the filters used.',
    },
  ],
} as const satisfies BlockMeta
