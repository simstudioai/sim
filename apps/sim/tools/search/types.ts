import type { ToolResponse } from '@/tools/types'

export interface SearchParams {
  query: string
}

export interface SearchResponse extends ToolResponse {
  output: {
    results: Array<{
      title: string
      link: string
      snippet: string
      date?: string
      position: number
    }>
    query: string
    totalResults: number
    source: 'exa'
    cost: {
      input: number
      output: number
      total: number
      tokens: {
        prompt: number
        completion: number
        total: number
      }
      model: string
      pricing?: {
        input: number
        cachedInput: number
        output: number
        updatedAt: string
      }
    }
  }
}
