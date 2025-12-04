import type { ToolConfig } from '@/tools/types'
import {
  WORDPRESS_COM_API_BASE,
  type WordPressUploadMediaParams,
  type WordPressUploadMediaResponse,
} from './types'

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
        visibility: 'user-only',
        description: 'WordPress.com site ID or domain (e.g., 12345678 or mysite.wordpress.com)',
      },
      file: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Base64 encoded file data or URL to fetch file from',
      },
      filename: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Filename with extension (e.g., image.jpg)',
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
      url: (params) => `${WORDPRESS_COM_API_BASE}/${params.siteId}/media`,
      method: 'POST',
      headers: (params) => {
        // Determine content type from filename
        const ext = params.filename.split('.').pop()?.toLowerCase() || ''
        const mimeTypes: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          gif: 'image/gif',
          webp: 'image/webp',
          svg: 'image/svg+xml',
          pdf: 'application/pdf',
          mp4: 'video/mp4',
          mp3: 'audio/mpeg',
          wav: 'audio/wav',
          doc: 'application/msword',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }
        const contentType = mimeTypes[ext] || 'application/octet-stream'

        return {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${params.filename}"`,
          Authorization: `Bearer ${params.accessToken}`,
        }
      },
      body: (params) => {
        // If the file is a base64 string, we need to decode it
        // The body function returns the data directly for binary uploads
        // In this case, we return the file data as-is and let the executor handle it
        return params.file as any
      },
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.message || `WordPress API error: ${response.status}`)
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          media: {
            id: data.id,
            date: data.date,
            slug: data.slug,
            type: data.type,
            link: data.link,
            title: data.title,
            caption: data.caption,
            alt_text: data.alt_text,
            media_type: data.media_type,
            mime_type: data.mime_type,
            source_url: data.source_url,
            media_details: data.media_details,
          },
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
