import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecordOrNull } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { YouComSearchImagesParams, YouComSearchImagesResponse } from '@/tools/youcom/types'
import {
  optionalNumber,
  YOUCOM_API_BASE_URL,
  youComApiKeyParam,
  youComHeaders,
} from '@/tools/youcom/utils'

export const youComSearchImagesTool: ToolConfig<
  YouComSearchImagesParams,
  YouComSearchImagesResponse
> = {
  id: 'youcom_search_images',
  name: 'You.com Search Images',
  description:
    'Find image URLs for a query with You.com. Beta, and limited to You.com early-access API keys.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Image search query. Supports site:, filetype: (e.g., filetype:png), and OR',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of images to return, from 1 to 100. Defaults to 10',
    },
    apiKey: youComApiKeyParam,
  },

  request: {
    url: (params) => {
      const url = new URL(`${YOUCOM_API_BASE_URL}/images`)
      url.searchParams.set('q', params.query)
      const count = optionalNumber(params.count)
      if (count !== undefined) url.searchParams.set('count', String(count))
      return url.toString()
    },
    method: 'GET',
    headers: youComHeaders,
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const images = toRecordOrNull(data.images) ?? {}
    const metadata = toRecordOrNull(data.metadata) ?? {}

    return {
      success: true,
      output: {
        images: toArray(images.results).map((item) => {
          const image = toRecordOrNull(item) ?? {}
          return {
            title: toStringOrNull(image.title),
            pageUrl: toStringOrNull(image.page_url),
            imageUrl: toStringOrNull(image.image_url),
            thumbnail: toStringOrNull(image.thumbnail),
            largeThumbnail: toStringOrNull(image.large_thumbnail),
          }
        }),
        query: toStringOrNull(metadata.query),
        searchUuid: toStringOrNull(metadata.search_uuid),
      },
    }
  },

  outputs: {
    images: {
      type: 'array',
      description: 'Image results',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the image result', nullable: true },
          pageUrl: {
            type: 'string',
            description: 'URL of the page containing the image',
            nullable: true,
          },
          imageUrl: { type: 'string', description: 'Direct URL to the image', nullable: true },
          thumbnail: { type: 'string', description: 'Proxy-hosted thumbnail URL', nullable: true },
          largeThumbnail: {
            type: 'string',
            description: 'Larger resized image URL; fall back to thumbnail or imageUrl if it fails',
            nullable: true,
          },
        },
      },
    },
    query: { type: 'string', description: 'Query that was submitted', nullable: true },
    searchUuid: { type: 'string', description: 'Unique ID of the search', nullable: true },
  },
}
