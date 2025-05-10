import { ToolResponse } from "../types"

export interface ScrapeParams {
    apiKey: string
    url: string
    scrapeOptions?: {
      onlyMainContent?: boolean
      formats?: string[]
    }
  }
  
  export interface ScrapeResponse extends ToolResponse {
    output: {
      markdown: string
      html?: string
      metadata: {
        title: string
        description: string
        language: string
        keywords: string
        robots: string
        ogTitle: string
        ogDescription: string
        ogUrl: string
        ogImage: string
        ogLocaleAlternate: string[]
        ogSiteName: string
        sourceURL: string
        statusCode: number
      }
    }
  }