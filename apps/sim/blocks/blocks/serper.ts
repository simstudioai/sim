import { SerperIcon } from '@/components/icons'
import { SerperBlockDisplay } from '@/blocks/blocks/serper.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { SearchResponse } from '@/tools/serper/types'

export const SerperBlock: BlockConfig<SearchResponse> = {
  ...SerperBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter your search query...',
      required: true,
    },
    {
      id: 'type',
      title: 'Search Type',
      type: 'dropdown',
      options: [
        { label: 'search', id: 'search' },
        { label: 'news', id: 'news' },
        { label: 'places', id: 'places' },
        { label: 'images', id: 'images' },
      ],
      value: () => 'search',
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'dropdown',
      options: [
        { label: '10', id: '10' },
        { label: '20', id: '20' },
        { label: '30', id: '30' },
        { label: '40', id: '40' },
        { label: '50', id: '50' },
        { label: '100', id: '100' },
      ],
    },
    {
      id: 'gl',
      title: 'Country',
      type: 'dropdown',
      options: [
        { label: 'US', id: 'US' },
        { label: 'GB', id: 'GB' },
        { label: 'CA', id: 'CA' },
        { label: 'AU', id: 'AU' },
        { label: 'DE', id: 'DE' },
        { label: 'FR', id: 'FR' },
      ],
    },
    {
      id: 'hl',
      title: 'Language',
      type: 'dropdown',
      options: [
        { label: 'en', id: 'en' },
        { label: 'es', id: 'es' },
        { label: 'fr', id: 'fr' },
        { label: 'de', id: 'de' },
        { label: 'it', id: 'it' },
      ],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Serper API key',
      password: true,
      required: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['serper_search'],
  },
  inputs: {
    query: { type: 'string', description: 'Search query terms' },
    apiKey: { type: 'string', description: 'Serper API key' },
    num: { type: 'number', description: 'Number of results' },
    gl: { type: 'string', description: 'Country code' },
    hl: { type: 'string', description: 'Language code' },
    type: { type: 'string', description: 'Search type' },
  },
  outputs: {
    searchResults: { type: 'json', description: 'Search results data' },
  },
}

export const SerperBlockMeta = {
  tags: ['web-scraping', 'seo'],
  url: 'https://serper.dev',
  templates: [
    {
      icon: SerperIcon,
      title: 'Serper SERP digest',
      prompt:
        'Build a scheduled daily workflow that runs Serper searches for tracked keywords, writes the SERP positions of my domain into a tables-based SEO log, and pings on changes.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SerperIcon,
      title: 'Serper competitor SERP watcher',
      prompt:
        'Create a workflow that runs Serper searches for competitor keywords weekly, captures top SERP entries, and writes a competitive SEO digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SerperIcon,
      title: 'Serper news monitor',
      prompt:
        'Build a scheduled workflow that uses Serper news search for brand keywords, classifies each result, and posts notable mentions to a Slack PR channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SerperIcon,
      title: 'Serper local-pack tracker',
      prompt:
        'Create a workflow that uses Serper to track Google local-pack rankings for tracked queries by city, writes the results to a tables-based SEO log, and surfaces wins.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: SerperIcon,
      title: 'Serper research agent',
      prompt:
        'Build an agent that uses Serper as a primary web-search tool, returns answers with citations, and saves long-form research to a knowledge base.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research'],
    },
    {
      icon: SerperIcon,
      title: 'Serper image-search collector',
      prompt:
        'Create a workflow that uses Serper image search for brand or product mentions, captures unique image URLs into a table, and flags potential trademark misuse.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: SerperIcon,
      title: 'Serper geo-SERP comparator',
      prompt:
        'Build a scheduled workflow that runs Serper across multiple regions for the same keywords, identifies geo-relevant ranking differences, and writes the analysis to a file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'research-web-topic',
      description:
        'Run a Serper web search on a topic and synthesize the top organic results into a sourced summary.',
      content:
        '# Research Web Topic\n\nGather current web results on a topic and turn them into a concise, sourced briefing.\n\n## Steps\n1. Run the search operation with a focused query. Set the country and language for the target audience and choose a result count (10 to 100) appropriate to the depth needed.\n2. Read the organic results, titles, snippets, and any answer box or knowledge graph data.\n3. Synthesize the findings, noting agreement and disagreement across sources.\n\n## Output\nReturn a short summary of what the web says about the topic, each key claim linked to the result URL it came from.',
    },
    {
      name: 'monitor-news-mentions',
      description:
        'Search recent news for a brand, person, or topic via Serper and summarize the coverage.',
      content:
        '# Monitor News Mentions\n\nTrack what the news is saying about a brand, competitor, person, or topic.\n\n## Steps\n1. Run the news operation with the entity or topic as the query, setting country and language to scope the coverage.\n2. Collect the headlines, sources, publish dates, and snippets.\n3. Group the coverage by sentiment or theme and highlight the most recent and most prominent items.\n\n## Output\nReturn a dated list of news items with source and headline, plus a short overall read on tone and notable developments.',
    },
    {
      name: 'compare-regional-rankings',
      description:
        'Run the same Serper query across multiple regions to compare search rankings by geography.',
      content:
        '# Compare Regional Rankings\n\nSee how search results differ for the same query across countries.\n\n## Steps\n1. Pick the target keyword and the set of countries to compare.\n2. Run the search operation once per country, varying only the country (and language where relevant), keeping the result count consistent.\n3. Line up the top organic results per region and note which domains rank where.\n\n## Output\nReturn a per-region ranking comparison for the keyword, calling out domains that rank strongly in some regions but not others.',
    },
    {
      name: 'find-local-businesses',
      description:
        'Use the Serper places operation to find local businesses for a query and area, and rank them.',
      content:
        '# Find Local Businesses\n\nPull Google Maps style local results for a query in a target area.\n\n## Steps\n1. Run the places operation with a query that includes the business type and location (for example coffee shops in Seattle), setting the country and language to scope results.\n2. Read each place result: name, address, rating, review count, category, and phone or website where present.\n3. Rank or filter the results by rating, review volume, or proximity to the target area.\n\n## Output\nReturn a ranked list of local businesses with name, address, rating, and review count, noting the top candidates for the query.',
    },
  ],
} as const satisfies BlockMeta
