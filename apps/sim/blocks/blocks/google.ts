import { GoogleSearchBlockDisplay } from '@/blocks/blocks/google.display'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GoogleSearchResponse } from '@/tools/google/types'

export const GoogleSearchBlock: BlockConfig<GoogleSearchResponse> = {
  ...GoogleSearchBlockDisplay,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter your search query',
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Google search query based on the user's description.
Create an effective search query that will find relevant results.
Use search operators when appropriate:
- "exact phrase" for exact matches
- site:domain.com to search within a site
- -word to exclude terms
- OR for alternatives
- filetype:pdf for specific file types

Examples:
- "latest AI news" -> latest artificial intelligence news 2024
- "python tutorials on youtube" -> site:youtube.com python tutorial
- "PDF reports about climate change" -> climate change report filetype:pdf

Return ONLY the search query - no explanations, no quotes around the whole thing, no extra text.`,
        placeholder: 'Describe what you want to search for...',
      },
    },
    {
      id: 'searchEngineId',
      title: 'Custom Search Engine ID',
      type: 'short-input',
      placeholder: 'Enter your Custom Search Engine ID',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Google API key',
      password: true,
      required: true,
    },
    {
      id: 'num',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '10 (1-10)',
      mode: 'advanced',
    },
    {
      id: 'start',
      title: 'Start Index',
      type: 'short-input',
      placeholder: '1 (for pagination; start + num <= 100)',
      mode: 'advanced',
    },
    {
      id: 'searchType',
      title: 'Search Type',
      type: 'dropdown',
      options: [
        { label: 'Web', id: '' },
        { label: 'Image', id: 'image' },
      ],
      mode: 'advanced',
    },
    {
      id: 'dateRestrict',
      title: 'Date Restrict',
      type: 'short-input',
      placeholder: 'e.g., d7, w2, m1, y1',
      mode: 'advanced',
    },
    {
      id: 'fileType',
      title: 'File Type',
      type: 'short-input',
      placeholder: 'e.g., pdf, doc',
      mode: 'advanced',
    },
    {
      id: 'safe',
      title: 'SafeSearch',
      type: 'dropdown',
      options: [
        { label: 'Off', id: '' },
        { label: 'Active', id: 'active' },
      ],
      mode: 'advanced',
    },
    {
      id: 'siteSearch',
      title: 'Site Search',
      type: 'short-input',
      placeholder: 'Domain to include or exclude (e.g., wikipedia.org)',
      mode: 'advanced',
    },
    {
      id: 'siteSearchFilter',
      title: 'Site Search Filter',
      type: 'dropdown',
      options: [
        { label: 'Include', id: 'i' },
        { label: 'Exclude', id: 'e' },
      ],
      condition: { field: 'siteSearch', value: '', not: true },
      mode: 'advanced',
    },
    {
      id: 'lr',
      title: 'Language Restrict',
      type: 'short-input',
      placeholder: 'e.g., lang_en',
      mode: 'advanced',
    },
    {
      id: 'gl',
      title: 'Country (geolocation)',
      type: 'short-input',
      placeholder: 'Two-letter country code (e.g., us)',
      mode: 'advanced',
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'short-input',
      placeholder: 'e.g., date',
      mode: 'advanced',
    },
  ],

  tools: {
    access: ['google_search'],
    config: {
      tool: () => 'google_search',
      params: (params) => ({
        query: params.query,
        apiKey: params.apiKey,
        searchEngineId: params.searchEngineId,
        num: params.num ? Number(params.num) : undefined,
        start: params.start ? Number(params.start) : undefined,
        dateRestrict: params.dateRestrict || undefined,
        fileType: params.fileType || undefined,
        safe: params.safe || undefined,
        searchType: params.searchType || undefined,
        siteSearch: params.siteSearch || undefined,
        siteSearchFilter: params.siteSearch ? params.siteSearchFilter || undefined : undefined,
        lr: params.lr || undefined,
        gl: params.gl || undefined,
        sort: params.sort || undefined,
      }),
    },
  },

  inputs: {
    query: { type: 'string', description: 'Search query terms' },
    apiKey: { type: 'string', description: 'Google API key' },
    searchEngineId: { type: 'string', description: 'Custom search engine ID' },
    num: { type: 'string', description: 'Number of results (1-10)' },
    start: { type: 'string', description: 'Start index for pagination (1-based)' },
    dateRestrict: { type: 'string', description: 'Restrict by recency (d/w/m/y notation)' },
    fileType: { type: 'string', description: 'Restrict to a file extension' },
    safe: { type: 'string', description: 'SafeSearch level (active/off)' },
    searchType: { type: 'string', description: 'Search type (image for image search)' },
    siteSearch: { type: 'string', description: 'Site to include or exclude' },
    siteSearchFilter: { type: 'string', description: 'Include (i) or exclude (e) the site' },
    lr: { type: 'string', description: 'Language restriction (e.g., lang_en)' },
    gl: { type: 'string', description: 'Country geolocation code' },
    sort: { type: 'string', description: 'Sort expression (e.g., date)' },
  },

  outputs: {
    items: { type: 'json', description: 'Search result items' },
    searchInformation: { type: 'json', description: 'Search metadata' },
    nextPageStartIndex: { type: 'number', description: 'Start index for the next page of results' },
  },
}
