import type {
  GoogleBooksVolumeDetailsParams,
  GoogleBooksVolumeDetailsResponse,
  GoogleBooksVolumeResponse,
} from '@/tools/google_books/types'
import type { ToolConfig } from '@/tools/types'

export const googleBooksVolumeDetailsTool: ToolConfig<
  GoogleBooksVolumeDetailsParams,
  GoogleBooksVolumeDetailsResponse
> = {
  id: 'google_books_volume_details',
  name: 'Google Books Volume Details',
  description: 'Get detailed information about a specific book volume',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Books API key',
    },
    volumeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the volume to retrieve',
    },
    projection: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Projection level (full, lite)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://www.googleapis.com/books/v1/volumes/${params.volumeId.trim()}`)
      url.searchParams.set('key', params.apiKey.trim())

      if (params.projection) {
        url.searchParams.set('projection', params.projection)
      }

      return url.toString()
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data: GoogleBooksVolumeResponse = await response.json()

    if (!data.volumeInfo) {
      throw new Error('Volume not found')
    }

    const info = data.volumeInfo
    const identifiers = info.industryIdentifiers ?? []

    return {
      success: true,
      output: {
        id: data.id,
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
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Volume ID',
    },
    title: {
      type: 'string',
      description: 'Book title',
    },
    subtitle: {
      type: 'string',
      description: 'Book subtitle',
      optional: true,
    },
    authors: {
      type: 'array',
      description: 'List of authors',
    },
    publisher: {
      type: 'string',
      description: 'Publisher name',
      optional: true,
    },
    publishedDate: {
      type: 'string',
      description: 'Publication date',
      optional: true,
    },
    description: {
      type: 'string',
      description: 'Book description',
      optional: true,
    },
    pageCount: {
      type: 'number',
      description: 'Number of pages',
      optional: true,
    },
    categories: {
      type: 'array',
      description: 'Book categories',
    },
    averageRating: {
      type: 'number',
      description: 'Average rating (1-5)',
      optional: true,
    },
    ratingsCount: {
      type: 'number',
      description: 'Number of ratings',
      optional: true,
    },
    language: {
      type: 'string',
      description: 'Language code',
      optional: true,
    },
    previewLink: {
      type: 'string',
      description: 'Link to preview on Google Books',
      optional: true,
    },
    infoLink: {
      type: 'string',
      description: 'Link to info page',
      optional: true,
    },
    thumbnailUrl: {
      type: 'string',
      description: 'Book cover thumbnail URL',
      optional: true,
    },
    isbn10: {
      type: 'string',
      description: 'ISBN-10 identifier',
      optional: true,
    },
    isbn13: {
      type: 'string',
      description: 'ISBN-13 identifier',
      optional: true,
    },
  },
}
