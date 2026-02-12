import type {
  GoogleBooksVolumeItem,
  GoogleBooksVolumeSearchParams,
  GoogleBooksVolumeSearchResponse,
  VolumeInfo,
} from '@/tools/google_books/types'
import type { ToolConfig } from '@/tools/types'

function extractVolumeInfo(item: GoogleBooksVolumeItem): VolumeInfo {
  const info = item.volumeInfo
  const identifiers = info.industryIdentifiers ?? []

  return {
    id: item.id,
    title: info.title ?? '',
    subtitle: info.subtitle ?? null,
    authors: info.authors ?? [],
    publisher: info.publisher ?? null,
    publishedDate: info.publishedDate ?? null,
    description: info.description ?? null,
    pageCount: info.pageCount ?? null,
    categories: info.categories ?? [],
    averageRating: info.averageRating ?? null,
    ratingsCount: info.ratingsCount ?? null,
    language: info.language ?? null,
    previewLink: info.previewLink ?? null,
    infoLink: info.infoLink ?? null,
    thumbnailUrl: info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null,
    isbn10: identifiers.find((id) => id.type === 'ISBN_10')?.identifier ?? null,
    isbn13: identifiers.find((id) => id.type === 'ISBN_13')?.identifier ?? null,
  }
}

export const googleBooksVolumeSearchTool: ToolConfig<
  GoogleBooksVolumeSearchParams,
  GoogleBooksVolumeSearchResponse
> = {
  id: 'google_books_volume_search',
  name: 'Google Books Volume Search',
  description: 'Search for books using the Google Books API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Books API key',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search query. Supports special keywords: intitle:, inauthor:, inpublisher:, subject:, isbn:',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter results by availability (partial, full, free-ebooks, paid-ebooks, ebooks)',
    },
    printType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to print type (all, books, magazines)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order (relevance, newest)',
    },
    startIndex: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first result to return (for pagination)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (1-40)',
    },
    langRestrict: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict results to a specific language (ISO 639-1 code)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://www.googleapis.com/books/v1/volumes')
      url.searchParams.set('q', params.query.trim())
      url.searchParams.set('key', params.apiKey.trim())

      if (params.filter) {
        url.searchParams.set('filter', params.filter)
      }
      if (params.printType) {
        url.searchParams.set('printType', params.printType)
      }
      if (params.orderBy) {
        url.searchParams.set('orderBy', params.orderBy)
      }
      if (params.startIndex !== undefined) {
        url.searchParams.set('startIndex', String(params.startIndex))
      }
      if (params.maxResults !== undefined) {
        url.searchParams.set('maxResults', String(params.maxResults))
      }
      if (params.langRestrict) {
        url.searchParams.set('langRestrict', params.langRestrict)
      }

      return url.toString()
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const items: GoogleBooksVolumeItem[] = data.items ?? []
    const volumes = items.map(extractVolumeInfo)

    return {
      success: true,
      output: {
        totalItems: data.totalItems ?? 0,
        volumes,
      },
    }
  },

  outputs: {
    totalItems: {
      type: 'number',
      description: 'Total number of matching results',
    },
    volumes: {
      type: 'array',
      description: 'List of matching volumes',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Volume ID' },
          title: { type: 'string', description: 'Book title' },
          subtitle: { type: 'string', description: 'Book subtitle' },
          authors: { type: 'array', description: 'List of authors' },
          publisher: { type: 'string', description: 'Publisher name' },
          publishedDate: { type: 'string', description: 'Publication date' },
          description: { type: 'string', description: 'Book description' },
          pageCount: { type: 'number', description: 'Number of pages' },
          categories: { type: 'array', description: 'Book categories' },
          averageRating: { type: 'number', description: 'Average rating (1-5)' },
          ratingsCount: { type: 'number', description: 'Number of ratings' },
          language: { type: 'string', description: 'Language code' },
          previewLink: { type: 'string', description: 'Link to preview on Google Books' },
          infoLink: { type: 'string', description: 'Link to info page' },
          thumbnailUrl: { type: 'string', description: 'Book cover thumbnail URL' },
          isbn10: { type: 'string', description: 'ISBN-10 identifier' },
          isbn13: { type: 'string', description: 'ISBN-13 identifier' },
        },
      },
    },
  },
}
