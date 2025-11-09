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

// Create Account
export interface SalesforceCreateAccountResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
    metadata: {
      operation: 'create_account'
    }
  }
}

// Update Account
export interface SalesforceUpdateAccountResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
    metadata: {
      operation: 'update_account'
    }
  }
}

// Delete Account
export interface SalesforceDeleteAccountResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: {
      operation: 'delete_account'
    }
  }
}

// Contact types
export interface SalesforceGetContactsResponse {
  success: boolean
  output: {
    contacts?: any[]
    contact?: any
    paging?: {
      nextRecordsUrl?: string
      totalSize: number
      done: boolean
    }
    metadata: {
      operation: 'get_contacts'
      totalReturned?: number
      hasMore?: boolean
      singleContact?: boolean
    }
    success: boolean
  }
}

export interface SalesforceCreateContactResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
    metadata: { operation: 'create_contact' }
  }
}

export interface SalesforceUpdateContactResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
    metadata: { operation: 'update_contact' }
  }
}

export interface SalesforceDeleteContactResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: { operation: 'delete_contact' }
  }
}

// Generic Salesforce response type for the block
export type SalesforceResponse =
  | SalesforceGetAccountsResponse
  | SalesforceCreateAccountResponse
  | SalesforceUpdateAccountResponse
  | SalesforceDeleteAccountResponse
  | SalesforceGetContactsResponse
  | SalesforceCreateContactResponse
  | SalesforceUpdateContactResponse
  | SalesforceDeleteContactResponse
  | { success: boolean; output: any } // Generic for leads, opportunities, cases, tasks
