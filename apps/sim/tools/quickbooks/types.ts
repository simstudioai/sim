import type { ToolResponse } from '@/tools/types'

export type QuickBooksEntityName = 'Vendor' | 'PurchaseOrder' | 'Bill'
export type QuickBooksEnvironment = 'production' | 'sandbox'

export interface QuickBooksBaseParams {
  accessToken: string
  realmId: string
  apiEnvironment?: QuickBooksEnvironment | string
  minorVersion?: string
}

export interface QuickBooksListParams extends QuickBooksBaseParams {
  startPosition?: string
  maxResults?: string
  activeOnly?: boolean | string
}

export interface QuickBooksQueryParams extends QuickBooksBaseParams {
  query: string
}

export type QuickBooksRecord = Record<string, unknown>

export interface QuickBooksFault {
  Error?: Array<{
    Message?: string
    Detail?: string
    code?: string
  }>
}

export interface QuickBooksQueryEnvelope {
  QueryResponse?: Record<string, unknown> & {
    Fault?: QuickBooksFault
  }
  Fault?: QuickBooksFault
}

export interface QuickBooksQueryOutput {
  items: QuickBooksRecord[]
  entity: string | null
  totalCount: number | null
  startPosition: number | null
  maxResults: number | null
  query: string
}

export interface QuickBooksQueryResponse extends ToolResponse {
  output: QuickBooksQueryOutput
}

export type QuickBooksResponse = QuickBooksQueryResponse
