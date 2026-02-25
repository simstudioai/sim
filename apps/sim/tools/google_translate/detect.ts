import type {
  GoogleTranslateDetectParams,
  GoogleTranslateDetectResponse,
} from '@/tools/google_translate/types'
import type { ToolConfig } from '@/tools/types'

export const googleTranslateDetectTool: ToolConfig<
  GoogleTranslateDetectParams,
  GoogleTranslateDetectResponse
> = {
  id: 'google_translate_detect',
  name: 'Google Translate Detect Language',
  description: 'Detect the language of text using the Google Cloud Translation API.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Google Cloud API key with Cloud Translation API enabled',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text to detect the language of',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://translation.googleapis.com/language/translate/v2/detect')
      url.searchParams.set('key', params.apiKey)
      return url.toString()
    },
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      q: params.text,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.error) {
      return {
        success: false,
        output: {
          language: '',
          confidence: null,
        },
        error: data.error.message ?? 'Google Translate API error',
      }
    }

    const detection = data.data?.detections?.[0]?.[0]

    return {
      success: true,
      output: {
        language: detection?.language ?? '',
        confidence: detection?.confidence ?? null,
      },
    }
  },

  outputs: {
    language: {
      type: 'string',
      description: 'The detected language code (e.g., "en", "es", "fr")',
    },
    confidence: {
      type: 'number',
      description: 'Confidence score of the detection',
      optional: true,
    },
  },
}
