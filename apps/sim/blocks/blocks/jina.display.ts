import { JinaAIIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const JinaBlockDisplay = {
  type: 'jina',
  name: 'Jina',
  description: 'Search the web or extract content from URLs',
  category: 'tools',
  bgColor: '#333333',
  icon: JinaAIIcon,
  longDescription:
    'Integrate Jina AI into the workflow. Search the web and get LLM-friendly results, or extract clean content from specific URLs with advanced parsing options.',
  docsLink: 'https://docs.sim.ai/integrations/jina',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay

export const JinaBlockMeta = {
  tags: ['web-scraping', 'knowledge-base'],
  url: 'https://jina.ai',
  templates: [
    {
      icon: JinaAIIcon,
      title: 'Jina URL-to-knowledge ingester',
      prompt:
        'Build a workflow that reads a list of source URLs with Jina Reader, converts each into clean text, and ingests the content into a research knowledge base for retrieval.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina web-research digest',
      prompt:
        'Create a scheduled workflow that runs Jina web search on tracked topics, reads the top results with Jina Reader, and writes a summarized digest to a research table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'research'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina web-content reader',
      prompt:
        'Build a workflow that uses Jina Reader to convert any URL into clean text, summarizes with an agent, and stores the result in a research knowledge base.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina competitor watch',
      prompt:
        'Create a scheduled workflow that reads competitor pricing and changelog pages with Jina Reader, diffs against the last snapshot, and posts notable changes to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina answer enrichment',
      prompt:
        'Build a workflow that takes a user question, runs a Jina web search for current sources, reads the top pages with Jina Reader, and has an agent answer with citations.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'automation'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina Slack research bot',
      prompt:
        'Create a Slack bot that runs Jina web search on the asked question, reads the most relevant results with Jina Reader, and replies with a summarized answer and source links.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'research'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: JinaAIIcon,
      title: 'Jina docs-to-Notion clipper',
      prompt:
        'Build a workflow that reads a submitted URL with Jina Reader, summarizes the content with an agent, and appends a clean clipped entry to a Notion research database.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
      alsoIntegrations: ['notion'],
    },
  ],
  skills: [
    {
      name: 'extract-article-content',
      description: 'Read a URL and return clean, LLM-ready text stripped of navigation and ads.',
      content:
        '# Extract Article Content\n\nTurn a messy web page into clean, readable text an agent can reason over.\n\n## Steps\n1. Take the target URL.\n2. Read the URL to get the parsed main content as markdown or text.\n3. Strip boilerplate (nav, footers, ads) if any remains and keep the core article body.\n\n## Output\nReturn the page title and the cleaned content, plus the source URL. Note if the page could not be fully extracted.',
    },
    {
      name: 'research-topic-from-web',
      description: 'Search the web for a topic and summarize the top results into a briefing.',
      content:
        '# Research a Topic From the Web\n\nGather and condense current web information on a topic.\n\n## Steps\n1. Run a web search for the topic with a focused query.\n2. Take the top results and read the most relevant URLs for full content.\n3. Synthesize the findings, noting points of agreement and disagreement across sources.\n\n## Output\nReturn a short briefing with key findings, each backed by the source URL it came from.',
    },
    {
      name: 'summarize-url',
      description: 'Fetch a single URL and produce a concise summary with the main takeaways.',
      content:
        '# Summarize a URL\n\nGive a quick, faithful summary of a single web page.\n\n## Steps\n1. Read the URL to extract its main content.\n2. Identify the core thesis and the most important supporting points.\n3. Condense into a short summary without adding outside information.\n\n## Output\nReturn the page title, a 3-5 bullet summary of the key takeaways, and the source URL.',
    },
  ],
} as const satisfies BlockMeta
