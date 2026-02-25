import type { GoogleTranslateParams, GoogleTranslateResponse } from '@/tools/google_translate/types'
import type { ToolConfig } from '@/tools/types'

export const googleTranslateTool: ToolConfig<GoogleTranslateParams, GoogleTranslateResponse> = {
  id: 'google_translate_text',
  name: 'Google Translate',
  description:
    'Translate text between languages using the Google Cloud Translation API. Supports auto-detection of the source language.',
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
      description: 'The text to translate',
    },
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target language code (e.g., "es", "fr", "de", "ja")',
    },
    source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Source language code. If omitted, the API will auto-detect the source language.',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Format of the text: "text" for plain text, "html" for HTML content',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://translation.googleapis.com/language/translate/v2')
      url.searchParams.set('key', params.apiKey)
      return url.toString()
    },
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        q: params.text,
        target: params.target,
      }
      if (params.source) body.source = params.source
      if (params.format) body.format = params.format
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.error) {
      return {
        success: false,
        output: {
          translatedText: '',
          detectedSourceLanguage: null,
        },
        error: data.error.message ?? 'Google Translate API error',
      }
    }

    const translation = data.data?.translations?.[0]

    return {
      success: true,
      output: {
        translatedText: translation?.translatedText ?? '',
        detectedSourceLanguage: translation?.detectedSourceLanguage ?? null,
      },
    }
  },

  outputs: {
    translatedText: {
      type: 'string',
      description: 'The translated text',
    },
    detectedSourceLanguage: {
      type: 'string',
      description: 'The detected source language code (if source was not specified)',
      optional: true,
    },
  },
}
