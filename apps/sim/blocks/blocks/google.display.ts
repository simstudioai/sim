import { GoogleIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleSearchBlockDisplay = {
  type: 'google_search',
  name: 'Google Search',
  description: 'Search the web',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleIcon,
  longDescription: 'Integrate Google Search into the workflow. Can search the web.',
  docsLink: 'https://docs.sim.ai/integrations/google_search',
  integrationType: IntegrationType.Search,
} satisfies BlockDisplay

export const GoogleSearchBlockMeta = {
  tags: ['web-scraping', 'seo'],
  url: 'https://developers.google.com/custom-search',
  templates: [
    {
      icon: GoogleIcon,
      title: 'Daily news digest',
      prompt:
        'Create a scheduled daily workflow that runs Google searches for the topics and competitors I care about, picks the most relevant fresh results, summarizes each in a sentence, and emails me a curated digest every morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research', 'content'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleIcon,
      title: 'Lead company researcher',
      prompt:
        "Build a workflow that watches my leads table for new rows, runs Google searches for each company's recent news, funding, and leadership, summarizes the findings with an agent, and writes a research brief back to the row.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
    },
    {
      icon: GoogleIcon,
      title: 'SERP rank tracker',
      prompt:
        'Create a scheduled weekly workflow that runs Google searches for my target keywords, records where my domain appears in the results, logs positions to a tables-based scorecard, and posts a Slack summary of gainers and losers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'seo', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleIcon,
      title: 'Brand mention monitor',
      prompt:
        'Build a scheduled workflow that searches Google for new mentions of my brand and key executives, filters out noise with an agent, and posts notable mentions with links to a Slack channel for the comms team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring', 'research'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleIcon,
      title: 'Research-backed answer agent',
      prompt:
        'Create an agent that takes any question, runs targeted Google searches to gather current sources, synthesizes a concise answer with citations, and returns it so the team gets sourced answers instead of guesses.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'team'],
    },
    {
      icon: GoogleIcon,
      title: 'Content gap explorer',
      prompt:
        'Build a workflow that runs Google searches for a seed topic and its related queries, extracts the recurring subtopics and questions competitors rank for, and writes a prioritized content brief to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'seo', 'research'],
    },
    {
      icon: GoogleIcon,
      title: 'Support answer finder',
      prompt:
        'Create a workflow that on a new support ticket runs Google searches scoped to our docs and trusted sources, finds the most relevant pages, and drafts a sourced reply for the agent to review before sending.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'research', 'automation'],
    },
  ],
  skills: [
    {
      name: 'search-the-web',
      description:
        'Run a Google web search and return the most relevant results with titles and links.',
      content:
        '# Search the Web\n\nFind current information with Google Custom Search.\n\n## Steps\n1. Turn the request into an effective query. Use operators when helpful: "exact phrase", `site:domain.com`, `-exclude`, `OR`, `filetype:pdf`.\n2. Set Number of Results to a sensible value (e.g., 10).\n3. Run the search with the API key and Custom Search Engine ID.\n4. Read the result items: title, link, and snippet.\n\n## Output\nA ranked list of results, each with title, URL, and a one-line snippet. Drop low-relevance hits and note if the query returned little so it can be broadened.',
    },
    {
      name: 'research-and-summarize',
      description:
        'Search Google for a topic, gather the best sources, and synthesize a cited answer.',
      content:
        '# Research and Summarize\n\nAnswer a question from fresh web sources.\n\n## Steps\n1. Break the question into 1-3 focused search queries.\n2. Run each search and collect the most relevant result items (title, link, snippet).\n3. Synthesize a concise answer grounded in the snippets; do not assert facts the sources do not support.\n4. Attribute each claim to its source link.\n\n## Output\nA short, sourced answer followed by a list of the sources used (title + URL). If sources conflict, say so rather than guessing.',
    },
    {
      name: 'monitor-mentions',
      description:
        'Search Google for recent mentions of a brand, person, or keyword and surface notable hits.',
      content:
        '# Monitor Mentions\n\nFind recent web mentions of a target term.\n\n## Steps\n1. Build queries for the brand/person/keyword, optionally scoped with `site:` for specific outlets or quotes for exact names.\n2. Run the searches and collect result items.\n3. Filter out irrelevant or stale hits and dedupe near-identical results.\n4. Classify each remaining mention (e.g., news, review, social) and gauge tone where possible.\n\n## Output\nA list of notable mentions: title, source URL, a one-line summary, and a tone tag. Lead with the most significant items.',
    },
  ],
} as const satisfies BlockMeta
