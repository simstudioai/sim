import type { ToolResponse } from '@/tools/types'

// Common Salesforce types
export interface SalesforceAccount {
  Id: string
  Name: string
  Type?: string
  Industry?: string
  BillingStreet?: string
  BillingCity?: string
  BillingState?: string
  BillingPostalCode?: string
  BillingCountry?: string
  Phone?: string
  Website?: string
  AnnualRevenue?: number
  NumberOfEmployees?: number
  Description?: string
  OwnerId?: string
  CreatedDate?: string
  LastModifiedDate?: string
  [key: string]: any
}

export interface SalesforcePaging {
  nextRecordsUrl?: string
  totalSize: number
  done: boolean
}

// Get Accounts
export interface SalesforceGetAccountsResponse extends ToolResponse {
  output: {
    accounts: SalesforceAccount[]
    paging?: SalesforcePaging
    metadata: {
      operation: 'get_accounts'
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface SalesforceGetAccountsParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  limit?: string
  fields?: string
  orderBy?: string
}

// Generic Salesforce response type for the block
export type SalesforceResponse = SalesforceGetAccountsResponse
