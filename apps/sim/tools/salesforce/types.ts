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

// Report types
export interface SalesforceListReportsResponse {
  success: boolean
  output: {
    reports: any[]
    metadata: {
      operation: 'list_reports'
      totalReturned: number
    }
    success: boolean
  }
}

export interface SalesforceGetReportResponse {
  success: boolean
  output: {
    report: any
    reportId: string
    metadata: {
      operation: 'get_report'
    }
    success: boolean
  }
}

export interface SalesforceRunReportResponse {
  success: boolean
  output: {
    reportId: string
    reportMetadata: any
    reportExtendedMetadata: any
    factMap: any
    groupingsDown: any
    groupingsAcross: any
    hasDetailRows: boolean
    allData: boolean
    metadata: {
      operation: 'run_report'
      reportName: string
      reportFormat: string
    }
    success: boolean
  }
}

export interface SalesforceListReportTypesResponse {
  success: boolean
  output: {
    reportTypes: any[]
    metadata: {
      operation: 'list_report_types'
      totalReturned: number
    }
    success: boolean
  }
}

// Dashboard types
export interface SalesforceListDashboardsResponse {
  success: boolean
  output: {
    dashboards: any[]
    metadata: {
      operation: 'list_dashboards'
      totalReturned: number
    }
    success: boolean
  }
}

export interface SalesforceGetDashboardResponse {
  success: boolean
  output: {
    dashboard: any
    dashboardId: string
    components: any[]
    metadata: {
      operation: 'get_dashboard'
      dashboardName: string
      folderId: string
      runningUser: any
    }
    success: boolean
  }
}

export interface SalesforceRefreshDashboardResponse {
  success: boolean
  output: {
    dashboard: any
    dashboardId: string
    components: any[]
    status: any
    metadata: {
      operation: 'refresh_dashboard'
      dashboardName: string
      refreshDate: string
    }
    success: boolean
  }
}

// Query types
export interface SalesforceQueryResponse {
  success: boolean
  output: {
    records: any[]
    totalSize: number
    done: boolean
    nextRecordsUrl?: string
    query: string
    metadata: {
      operation: 'query'
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface SalesforceQueryMoreResponse {
  success: boolean
  output: {
    records: any[]
    totalSize: number
    done: boolean
    nextRecordsUrl?: string
    metadata: {
      operation: 'query_more'
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface SalesforceDescribeObjectResponse {
  success: boolean
  output: {
    objectName: string
    label: string
    labelPlural: string
    fields: any[]
    keyPrefix: string
    queryable: boolean
    createable: boolean
    updateable: boolean
    deletable: boolean
    childRelationships: any[]
    recordTypeInfos: any[]
    metadata: {
      operation: 'describe_object'
      fieldCount: number
    }
    success: boolean
  }
}

export interface SalesforceListObjectsResponse {
  success: boolean
  output: {
    objects: any[]
    encoding: string
    maxBatchSize: number
    metadata: {
      operation: 'list_objects'
      totalReturned: number
    }
    success: boolean
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
  | SalesforceListReportsResponse
  | SalesforceGetReportResponse
  | SalesforceRunReportResponse
  | SalesforceListReportTypesResponse
  | SalesforceListDashboardsResponse
  | SalesforceGetDashboardResponse
  | SalesforceRefreshDashboardResponse
  | SalesforceQueryResponse
  | SalesforceQueryMoreResponse
  | SalesforceDescribeObjectResponse
  | SalesforceListObjectsResponse
  | { success: boolean; output: any } // Generic for leads, opportunities, cases, tasks
