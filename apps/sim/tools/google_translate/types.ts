import type { ToolResponse } from '@/tools/types'

export interface GoogleTranslateParams {
  apiKey: string
  text: string
  target: string
  source?: string
  format?: 'text' | 'html'
}

export interface GoogleTranslateResponse extends ToolResponse {
  output: {
    translatedText: string
    detectedSourceLanguage: string | null
  }
}

export interface GoogleTranslateDetectParams {
  apiKey: string
  text: string
}

export interface GoogleTranslateDetectResponse extends ToolResponse {
  output: {
    language: string
    confidence: number | null
  }
}
