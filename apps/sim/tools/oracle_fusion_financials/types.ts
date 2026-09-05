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

export interface OracleFusionFinancialsInvoiceLineParams
  extends OracleFusionFinancialsInvoiceParams {
  invoiceLineUniqId: string
}

export interface OracleFusionFinancialsInvoiceInstallmentParams
  extends OracleFusionFinancialsInvoiceParams {
  invoiceInstallmentUniqId: string
}

export interface OracleFusionFinancialsInvoiceDistributionListParams
  extends OracleFusionFinancialsInvoiceLineParams,
    OracleFusionFinancialsListParams {}

export interface OracleFusionFinancialsInvoiceDistributionParams
  extends OracleFusionFinancialsInvoiceLineParams {
  invoiceDistributionId: string
}

export interface OracleFusionFinancialsAppliedPrepaymentParams
  extends OracleFusionFinancialsInvoiceParams {
  appliedPrepaymentUniqId: string
}

export interface OracleFusionFinancialsAvailablePrepaymentParams
  extends OracleFusionFinancialsInvoiceParams {
  availablePrepaymentUniqId: string
}

export interface OracleFusionFinancialsPaymentParams extends OracleFusionFinancialsAuthParams {
  checkId: string
}

export interface OracleFusionFinancialsPaymentRelatedInvoiceListParams
  extends OracleFusionFinancialsPaymentParams,
    OracleFusionFinancialsListParams {}

export interface OracleFusionFinancialsPaymentRelatedInvoiceParams
  extends OracleFusionFinancialsPaymentParams {
  invoicePaymentId: string
}

export interface OracleFusionFinancialsInvoiceHoldParams extends OracleFusionFinancialsAuthParams {
  holdId: string
}

export interface OracleFusionFinancialsPaymentProcessRequestParams
  extends OracleFusionFinancialsAuthParams {
  paymentProcessRequestId: string
}

export interface OracleFusionFinancialsPaymentTermParams extends OracleFusionFinancialsAuthParams {
  termsId: string
}

export interface OracleFusionFinancialsPaymentTermLineListParams
  extends OracleFusionFinancialsPaymentTermParams,
    OracleFusionFinancialsListParams {}

export interface OracleFusionFinancialsPaymentTermLineParams
  extends OracleFusionFinancialsPaymentTermParams {
  paymentTermLineUniqId: string
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

export type OracleFusionFinancialsDetailResponse<Wrapper extends string> = ToolResponse & {
  output: Record<Wrapper, Record<string, unknown>>
}
