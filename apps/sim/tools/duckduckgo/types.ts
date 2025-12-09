// Common types for DuckDuckGo tools
import type { ToolResponse } from '@/tools/types'

// Search tool types
export interface DuckDuckGoSearchParams {
  query: string
  noHtml?: boolean
  skipDisambig?: boolean
}

export interface DuckDuckGoRelatedTopic {
  FirstURL?: string
  Text?: string
  Result?: string
  Icon?: {
    URL?: string
    Height?: string
    Width?: string
  }
}

export interface DuckDuckGoResult {
  FirstURL?: string
  Text?: string
  Result?: string
  Icon?: {
    URL?: string
    Height?: string
    Width?: string
  }
}

export interface DuckDuckGoSearchOutput {
  heading: string
  abstract: string
  abstractText: string
  abstractSource: string
  abstractURL: string
  image: string
  answer: string
  answerType: string
  type: string
  relatedTopics: DuckDuckGoRelatedTopic[]
  results: DuckDuckGoResult[]
}

export interface DuckDuckGoSearchResponse extends ToolResponse {
  output: DuckDuckGoSearchOutput
}

export type DuckDuckGoResponse = DuckDuckGoSearchResponse
