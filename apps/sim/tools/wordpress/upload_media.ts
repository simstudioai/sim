import type { ToolConfig } from '@/tools/types'
import type {
  WordPressUploadMediaParams,
  WordPressUploadMediaResponse,
} from '@/tools/wordpress/types'

export const uploadMediaTool: ToolConfig<WordPressUploadMediaParams, WordPressUploadMediaResponse> =
  {
    id: 'wordpress_upload_media',
    name: 'WordPress Upload Media',
    description: 'Upload a media file (image, video, document) to WordPress.com',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'wordpress',
      requiredScopes: ['global'],
    },

    params: {
      siteId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'WordPress.com site ID or domain (e.g., 12345678 or mysite.wordpress.com)',
      },
      file: {
        type: 'file',
        required: false,
        visibility: 'hidden',
        description: 'File to upload (UserFile object)',
      },
      filename: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional filename override (e.g., image.jpg)',
      },
      title: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Media title',
      },
      caption: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Media caption',
      },
      altText: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Alternative text for accessibility',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Media description',
      },
    },

    request: {
      url: () => '/api/tools/wordpress/upload',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        accessToken: params.accessToken,
        siteId: params.siteId,
        file: params.file,
        filename: params.filename,
        title: params.title,
        caption: params.caption,
        altText: params.altText,
        description: params.description,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to upload media to WordPress')
      }

      return {
        success: true,
        output: {
          media: data.output.media,
        },
      }
    },

    outputs: {
      media: {
        type: 'object',
        description: 'The uploaded media item',
        properties: {
          id: { type: 'number', description: 'Media ID' },
          date: { type: 'string', description: 'Upload date' },
          slug: { type: 'string', description: 'Media slug' },
          type: { type: 'string', description: 'Content type' },
          link: { type: 'string', description: 'Media page URL' },
          title: { type: 'object', description: 'Media title object' },
          caption: { type: 'object', description: 'Media caption object' },
          alt_text: { type: 'string', description: 'Alt text' },
          media_type: { type: 'string', description: 'Media type (image, video, etc.)' },
          mime_type: { type: 'string', description: 'MIME type' },
          source_url: { type: 'string', description: 'Direct URL to the media file' },
          media_details: { type: 'object', description: 'Media details (dimensions, etc.)' },
        },
      },
    },
  }
