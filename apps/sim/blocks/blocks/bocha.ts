import { BoChaIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { BoChaSearchResponse } from '@/tools/bocha/types'

export const BoChaBlock: BlockConfig<BoChaSearchResponse> = {
    type: 'bocha',
    name: 'BoCha',
    description: 'Search with BoCha',
    longDescription:
        'Search the web using BoCha Instant Answers API. Returns instant answers, abstracts, related topics, and more.',
    docsLink: 'https://docs.sim.ai/tools/bocha',
    category: 'tools',
    bgColor: '#FFFFFF',
    icon: BoChaIcon,
    subBlocks: [
        {
            id: 'query',
            title: 'Search Query',
            type: 'long-input',
            placeholder: 'Enter your search query',
            required: true,
        },
        {
            id: 'freshness',
            title: 'Freshness',
            type: 'long-input',
            placeholder: 'noLimit',
            description: 'Search for web pages within a specified time range(noLimit/oneDay/oneWeek/oneMonth/oneYear/YYYY-MM-DD/YYYY-MM-DD/YYYY-MM-DD..YYYY-MM-DD)',
        },
        {
            id: 'summary',
            title: 'Show Summary',
            type: 'switch',
            defaultValue: false,
        },
        {
            id: 'count',
            title: 'Result Count',
            type: 'short-input',
            min: 1,
            max: 50,
            placeholder: 'e.g. 5',
        },
        {
            id: 'include',
            title: 'Include Domains',
            type: 'long-input',
            placeholder: 'example.com | arxiv.org',
            description: 'Limit search to specific domains (separate by | or ,)',
        },
        {
            id: 'exclude',
            title: 'Exclude Domains',
            type: 'long-input',
            placeholder: 'spam.com | ads.example',
            description: 'Exclude specific domains from search results',
        },
        {
            id: 'apiKey',
            title: 'API Key',
            type: 'short-input',
            placeholder: 'Enter your BoCha API key',
            password: true,
            required: true,
        },
    ],
    tools: {
        access: ['bocha_search'],
        config: {
            tool: () => 'bocha_search',
        },
    },
    inputs: {
        query: { type: 'string', description: 'Search query terms' },
        freshness: { type: 'string', description: 'Time range filter for search results' },
        summary: { type: 'boolean', description: 'Whether to return a text summary' },
        count: { type: 'number', description: 'Maximum number of search results to return' },
        include: { type: 'string', description: 'Domains to include in search results' },
        exclude: { type: 'string', description: 'Domains to exclude from search results' },
        apiKey: { type: 'string', description: 'BoCha API key' },
    },
    outputs: {
        query: { type: 'string', description: 'Search query used' },
        results: { type: 'json', description: 'Array of external link results' },
    },
}
