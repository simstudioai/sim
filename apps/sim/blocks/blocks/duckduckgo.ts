import { DuckDuckGoIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { DuckDuckGoResponse } from '@/tools/duckduckgo/types'

export const DuckDuckGoBlock: BlockConfig<DuckDuckGoResponse> = {
  type: 'duckduckgo',
  name: 'DuckDuckGo',
  description: 'Search with DuckDuckGo',
  longDescription:
    'Search the web using DuckDuckGo Instant Answers API. Returns instant answers, abstracts, related topics, and more. Free to use without an API key.',
  docsLink: 'https://docs.sim.ai/tools/duckduckgo',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: DuckDuckGoIcon,
  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query...',
      required: true,
    },
    {
      id: 'noHtml',
      title: 'Remove HTML',
      type: 'switch',
      defaultValue: true,
    },
    {
      id: 'skipDisambig',
      title: 'Skip Disambiguation',
      type: 'switch',
    },
  ],
  tools: {
    access: ['duckduckgo_search'],
    config: {
      tool: () => 'duckduckgo_search',
    },
  },
  inputs: {
    query: { type: 'string', description: 'Search query terms' },
    noHtml: { type: 'boolean', description: 'Remove HTML from text in results' },
    skipDisambig: { type: 'boolean', description: 'Skip disambiguation results' },
  },
  outputs: {
    heading: { type: 'string', description: 'The heading/title of the instant answer' },
    abstract: { type: 'string', description: 'A short abstract summary of the topic' },
    abstractText: { type: 'string', description: 'Plain text version of the abstract' },
    abstractSource: { type: 'string', description: 'The source of the abstract' },
    abstractURL: { type: 'string', description: 'URL to the source of the abstract' },
    image: { type: 'string', description: 'URL to an image related to the topic' },
    answer: { type: 'string', description: 'Direct answer if available' },
    answerType: { type: 'string', description: 'Type of the answer' },
    type: { type: 'string', description: 'Response type (A, D, C, N, E)' },
    relatedTopics: { type: 'json', description: 'Array of related topics' },
    results: { type: 'json', description: 'Array of external link results' },
  },
}
