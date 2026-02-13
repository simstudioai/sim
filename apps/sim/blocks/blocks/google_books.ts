import { GoogleBooksIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const GoogleBooksBlock: BlockConfig = {
  type: 'google_books',
  name: 'Google Books',
  description: 'Search and retrieve book information',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Search for books using the Google Books API. Find volumes by title, author, ISBN, or keywords, and retrieve detailed information about specific books including descriptions, ratings, and publication details.',
  docsLink: 'https://docs.sim.ai/tools/google_books',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleBooksIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search Volumes', id: 'volume_search' },
        { label: 'Get Volume Details', id: 'volume_details' },
      ],
      value: () => 'volume_search',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Google Books API key',
      required: true,
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., intitle:harry potter inauthor:rowling',
      condition: { field: 'operation', value: 'volume_search' },
      required: { field: 'operation', value: 'volume_search' },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Partial Preview', id: 'partial' },
        { label: 'Full Preview', id: 'full' },
        { label: 'Free eBooks', id: 'free-ebooks' },
        { label: 'Paid eBooks', id: 'paid-ebooks' },
        { label: 'All eBooks', id: 'ebooks' },
      ],
      condition: { field: 'operation', value: 'volume_search' },
      mode: 'advanced',
    },
    {
      id: 'printType',
      title: 'Print Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Books', id: 'books' },
        { label: 'Magazines', id: 'magazines' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'volume_search' },
      mode: 'advanced',
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'dropdown',
      options: [
        { label: 'Relevance', id: 'relevance' },
        { label: 'Newest', id: 'newest' },
      ],
      value: () => 'relevance',
      condition: { field: 'operation', value: 'volume_search' },
      mode: 'advanced',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Number of results (1-40)',
      condition: { field: 'operation', value: 'volume_search' },
      mode: 'advanced',
    },
    {
      id: 'startIndex',
      title: 'Start Index',
      type: 'short-input',
      placeholder: 'Starting index for pagination',
      condition: { field: 'operation', value: 'volume_search' },
      mode: 'advanced',
    },
    {
      id: 'langRestrict',
      title: 'Language',
      type: 'short-input',
      placeholder: 'ISO 639-1 code (e.g., en, es, fr)',
      condition: { field: 'operation', value: 'volume_search' },
      mode: 'advanced',
    },
    {
      id: 'volumeId',
      title: 'Volume ID',
      type: 'short-input',
      placeholder: 'Google Books volume ID',
      condition: { field: 'operation', value: 'volume_details' },
      required: { field: 'operation', value: 'volume_details' },
    },
    {
      id: 'projection',
      title: 'Projection',
      type: 'dropdown',
      options: [
        { label: 'Full', id: 'full' },
        { label: 'Lite', id: 'lite' },
      ],
      value: () => 'full',
      condition: { field: 'operation', value: 'volume_details' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: ['google_books_volume_search', 'google_books_volume_details'],
    config: {
      tool: (params) => `google_books_${params.operation}`,
      params: (params) => {
        const { operation, ...rest } = params

        let maxResults: number | undefined
        if (params.maxResults) {
          maxResults = Number.parseInt(params.maxResults, 10)
          if (Number.isNaN(maxResults)) {
            maxResults = undefined
          }
        }

        let startIndex: number | undefined
        if (params.startIndex) {
          startIndex = Number.parseInt(params.startIndex, 10)
          if (Number.isNaN(startIndex)) {
            startIndex = undefined
          }
        }

        return {
          ...rest,
          maxResults,
          startIndex,
          filter: params.filter || undefined,
          printType: params.printType || undefined,
          orderBy: params.orderBy || undefined,
          projection: params.projection || undefined,
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Google Books API key' },
    query: { type: 'string', description: 'Search query' },
    filter: { type: 'string', description: 'Filter by availability' },
    printType: { type: 'string', description: 'Print type filter' },
    orderBy: { type: 'string', description: 'Sort order' },
    maxResults: { type: 'string', description: 'Maximum number of results' },
    startIndex: { type: 'string', description: 'Starting index for pagination' },
    langRestrict: { type: 'string', description: 'Language restriction' },
    volumeId: { type: 'string', description: 'Volume ID for details' },
    projection: { type: 'string', description: 'Projection level' },
  },

  outputs: {
    totalItems: { type: 'number', description: 'Total number of matching results' },
    volumes: { type: 'json', description: 'List of matching volumes' },
    id: { type: 'string', description: 'Volume ID' },
    title: { type: 'string', description: 'Book title' },
    subtitle: { type: 'string', description: 'Book subtitle' },
    authors: { type: 'json', description: 'List of authors' },
    publisher: { type: 'string', description: 'Publisher name' },
    publishedDate: { type: 'string', description: 'Publication date' },
    description: { type: 'string', description: 'Book description' },
    pageCount: { type: 'number', description: 'Number of pages' },
    categories: { type: 'json', description: 'Book categories' },
    averageRating: { type: 'number', description: 'Average rating (1-5)' },
    ratingsCount: { type: 'number', description: 'Number of ratings' },
    language: { type: 'string', description: 'Language code' },
    previewLink: { type: 'string', description: 'Link to preview on Google Books' },
    infoLink: { type: 'string', description: 'Link to info page' },
    thumbnailUrl: { type: 'string', description: 'Book cover thumbnail URL' },
    isbn10: { type: 'string', description: 'ISBN-10 identifier' },
    isbn13: { type: 'string', description: 'ISBN-13 identifier' },
  },
}
