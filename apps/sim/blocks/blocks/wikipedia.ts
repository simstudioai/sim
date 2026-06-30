import { WikipediaIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { WikipediaResponse } from '@/tools/wikipedia/types'

export const WikipediaBlock: BlockConfig<WikipediaResponse> = {
  type: 'wikipedia',
  name: 'Wikipedia',
  description: 'Search and retrieve content from Wikipedia',
  longDescription:
    'Integrate Wikipedia into the workflow. Can get page summary, search pages, get page content, and get random page.',
  docsLink: 'https://docs.sim.ai/integrations/wikipedia',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#000000',
  icon: WikipediaIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Page Summary', id: 'wikipedia_summary' },
        { label: 'Search Pages', id: 'wikipedia_search' },
        { label: 'Get Page Content', id: 'wikipedia_content' },
        { label: 'Random Page', id: 'wikipedia_random' },
      ],
      value: () => 'wikipedia_summary',
    },
    // Page Summary operation inputs
    {
      id: 'pageTitle',
      title: 'Page Title',
      type: 'long-input',
      placeholder: 'Enter Wikipedia page title (e.g., "Python programming language")...',
      condition: { field: 'operation', value: 'wikipedia_summary' },
      required: true,
    },
    // Search Pages operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter search terms...',
      condition: { field: 'operation', value: 'wikipedia_search' },
      required: true,
    },
    {
      id: 'searchLimit',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'wikipedia_search' },
    },
    // Get Page Content operation inputs
    {
      id: 'pageTitle',
      title: 'Page Title',
      type: 'long-input',
      placeholder: 'Enter Wikipedia page title...',
      condition: { field: 'operation', value: 'wikipedia_content' },
      required: true,
    },
  ],
  tools: {
    access: ['wikipedia_summary', 'wikipedia_search', 'wikipedia_content', 'wikipedia_random'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'wikipedia_summary':
            return 'wikipedia_summary'
          case 'wikipedia_search':
            return 'wikipedia_search'
          case 'wikipedia_content':
            return 'wikipedia_content'
          case 'wikipedia_random':
            return 'wikipedia_random'
          default:
            return 'wikipedia_summary'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.searchLimit) result.searchLimit = Number(params.searchLimit)
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    // Page Summary & Content operations
    pageTitle: { type: 'string', description: 'Wikipedia page title' },
    // Search operation
    query: { type: 'string', description: 'Search query terms' },
    searchLimit: { type: 'number', description: 'Maximum search results' },
  },
  outputs: {
    // Page Summary output
    summary: { type: 'json', description: 'Page summary data' },
    // Search output
    searchResults: { type: 'json', description: 'Search results data' },
    totalHits: { type: 'number', description: 'Total search hits' },
    // Page Content output
    content: { type: 'json', description: 'Page content data' },
    // Random Page output
    randomPage: { type: 'json', description: 'Random page data' },
  },
}

export const WikipediaBlockMeta = {
  tags: ['knowledge-base'],
  url: 'https://www.wikipedia.org',
  templates: [
    {
      icon: WikipediaIcon,
      title: 'Wikipedia background-research helper',
      prompt:
        'Build a workflow that for a chosen topic queries Wikipedia, extracts the lead and infobox, and writes a structured background brief file for the user.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: WikipediaIcon,
      title: 'Wikipedia entity disambiguator',
      prompt:
        'Create a workflow that for an ambiguous person or company name queries Wikipedia, identifies the most likely entity given context, and writes the canonical reference back.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'analysis'],
    },
    {
      icon: WikipediaIcon,
      title: 'Wikipedia knowledge-base seeder',
      prompt:
        'Build a workflow that for tracked topics fetches Wikipedia articles, chunks and embeds them, and seeds a knowledge base with canonical context.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: WikipediaIcon,
      title: 'Wikipedia citation validator',
      prompt:
        'Create a workflow that checks if claims drafted by an agent are supported by Wikipedia content, flags claims without strong sources, and writes a quality score.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'analysis'],
    },
    {
      icon: WikipediaIcon,
      title: 'Wikipedia infobox extractor',
      prompt:
        'Build a workflow that takes a list of entity names, extracts the Wikipedia infobox fields for each, and writes structured rows for downstream analytics.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: WikipediaIcon,
      title: 'Wikipedia related-topic graph',
      prompt:
        'Create a workflow that for a topic explores related Wikipedia pages, builds a topic graph in Neo4j, and surfaces adjacent themes.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['research', 'analysis'],
      alsoIntegrations: ['neo4j'],
    },
    {
      icon: WikipediaIcon,
      title: 'Wikipedia summary alerter',
      prompt:
        'Build a scheduled workflow that monitors Wikipedia pages for tracked entities, detects significant edits, and posts a summary diff to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'research'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'research-topic-brief',
      description: 'Search Wikipedia for a topic and assemble a concise, sourced background brief.',
      content:
        '# Build a Wikipedia Topic Brief\n\nProduce a quick, reliable background brief on a subject.\n\n## Steps\n1. Search pages for the topic to find the best-matching article title.\n2. Get the page summary for a fast overview, then get full page content if more depth is needed.\n3. Extract the key facts, dates, and definitions, ignoring tangential detail.\n4. Assemble a short brief in your own words.\n\n## Output\nReturn a brief with a one-line definition, three to five key points, and the Wikipedia page title used as the source.',
    },
    {
      name: 'disambiguate-entity',
      description:
        'Resolve an ambiguous name to the correct Wikipedia entity using surrounding context.',
      content:
        '# Disambiguate an Entity via Wikipedia\n\nPick the right Wikipedia entity for an ambiguous name.\n\n## Steps\n1. Search pages for the name to retrieve candidate matches.\n2. For the top candidates, get the page summary.\n3. Compare each summary against the context provided (industry, location, role) and choose the best fit.\n4. If nothing matches confidently, say so rather than forcing a choice.\n\n## Output\nReturn the chosen canonical page title with a one-line justification, plus a confidence note and any close alternatives.',
    },
    {
      name: 'verify-claim',
      description:
        'Check whether a stated claim is supported by Wikipedia content and flag unsupported claims.',
      content:
        '# Verify a Claim Against Wikipedia\n\nFact-check a claim using Wikipedia as a reference source.\n\n## Steps\n1. Identify the entity or topic the claim is about and search for its page.\n2. Get the page summary or content covering the relevant section.\n3. Compare the claim against the article text and decide if it is supported, contradicted, or not addressed.\n\n## Output\nReturn a verdict of supported, contradicted, or unverified, with the supporting sentence quoted and the page title cited. Do not treat absence of mention as proof either way.',
    },
  ],
} as const satisfies BlockMeta
