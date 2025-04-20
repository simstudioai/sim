import { ToolResponse } from "../types"

export interface LinkupSource {
  name: string
  url: string
  snippet: string
}

export interface LinkupSearchParams {
  q: string
  apiKey: string
  depth?: 'standard' | 'deep'
  outputType?: 'sourcedAnswer' | 'searchResults'
}

export interface LinkupSearchResponse {
  answer: string
  sources: LinkupSource[]
} 

export interface LinkupSearchToolResponse extends ToolResponse {
    output: LinkupSearchResponse
  }