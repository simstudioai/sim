import type { ToolResponse } from '@/tools/types'

export interface OracleFusionFinancialsAuthParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}

export interface OracleFusionFinancialsListParams extends OracleFusionFinancialsAuthParams {
  q?: string
  finder?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionFinancialsListInvoicesParams extends OracleFusionFinancialsListParams {
  effectiveDate?: string
}

export interface OracleFusionFinancialsInvoiceParams extends OracleFusionFinancialsAuthParams {
  invoiceUniqId: string
}

export interface OracleFusionFinancialsInvoiceChildListParams
  extends OracleFusionFinancialsListParams {
  invoiceUniqId: string
}

export interface OracleFusionFinancialsPaymentParams extends OracleFusionFinancialsAuthParams {
  checkId: string
}

export interface OracleFusionFinancialsListEnvelope {
  items: Array<Record<string, unknown>>
  count: number
  hasMore: boolean
  limit: number
  offset: number
  totalResults?: number
}

export interface OracleFusionFinancialsListResponse extends ToolResponse {
  output: OracleFusionFinancialsListEnvelope
}

export interface OracleFusionFinancialsInvoiceResponse extends ToolResponse {
  output: { invoice: Record<string, unknown> }
}

export interface OracleFusionFinancialsPaymentResponse extends ToolResponse {
  output: { payment: Record<string, unknown> }
}
