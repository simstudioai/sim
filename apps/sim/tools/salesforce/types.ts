import type { ToolResponse } from '@/tools/types'

/**
 * Base parameters shared by all Salesforce operations
 */
export interface BaseSalesforceParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
}

/**
 * Common paging structure for list operations
 */
export interface SalesforcePaging {
  nextRecordsUrl?: string
  totalSize: number
  done: boolean
}

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

export interface SalesforceGetAccountsParams extends BaseSalesforceParams {
  limit?: string
  fields?: string
  orderBy?: string
}

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

export interface SalesforceCreateAccountParams extends BaseSalesforceParams {
  name: string
  type?: string
  industry?: string
  phone?: string
  website?: string
  billingStreet?: string
  billingCity?: string
  billingState?: string
  billingPostalCode?: string
  billingCountry?: string
  description?: string
  annualRevenue?: string
  numberOfEmployees?: string
}

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

export interface SalesforceUpdateAccountParams extends BaseSalesforceParams {
  accountId: string
  name?: string
  type?: string
  industry?: string
  phone?: string
  website?: string
  billingStreet?: string
  billingCity?: string
  billingState?: string
  billingPostalCode?: string
  billingCountry?: string
  description?: string
  annualRevenue?: string
  numberOfEmployees?: string
}

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

export interface SalesforceDeleteAccountParams extends BaseSalesforceParams {
  accountId: string
}

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

export interface SalesforceGetContactsParams extends BaseSalesforceParams {
  contactId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetContactsResponse {
  success: boolean
  output: {
    contacts?: any[]
    contact?: any
    paging?: SalesforcePaging
    metadata: {
      operation: 'get_contacts'
      totalReturned?: number
      hasMore?: boolean
      singleContact?: boolean
    }
    success: boolean
  }
}

export interface SalesforceCreateContactParams extends BaseSalesforceParams {
  lastName: string
  firstName?: string
  email?: string
  phone?: string
  accountId?: string
  title?: string
  department?: string
  mailingStreet?: string
  mailingCity?: string
  mailingState?: string
  mailingPostalCode?: string
  mailingCountry?: string
  description?: string
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

export interface SalesforceUpdateContactParams extends BaseSalesforceParams {
  contactId: string
  lastName?: string
  firstName?: string
  email?: string
  phone?: string
  accountId?: string
  title?: string
  department?: string
  mailingStreet?: string
  mailingCity?: string
  mailingState?: string
  mailingPostalCode?: string
  mailingCountry?: string
  description?: string
}

export interface SalesforceUpdateContactResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
    metadata: { operation: 'update_contact' }
  }
}

export interface SalesforceDeleteContactParams extends BaseSalesforceParams {
  contactId: string
}

export interface SalesforceDeleteContactResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: { operation: 'delete_contact' }
  }
}

export interface SalesforceGetLeadsParams extends BaseSalesforceParams {
  leadId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetLeadsResponse {
  success: boolean
  output: {
    lead?: any
    leads?: any[]
    paging?: SalesforcePaging
    metadata: {
      operation: 'get_leads'
      totalReturned?: number
      hasMore?: boolean
      singleLead?: boolean
    }
    success: boolean
  }
}

export interface SalesforceCreateLeadParams extends BaseSalesforceParams {
  lastName: string
  company: string
  firstName?: string
  email?: string
  phone?: string
  status?: string
  leadSource?: string
  title?: string
  description?: string
}

export interface SalesforceCreateLeadResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
    metadata: {
      operation: 'create_lead'
    }
  }
}

export interface SalesforceUpdateLeadParams extends BaseSalesforceParams {
  leadId: string
  lastName?: string
  company?: string
  firstName?: string
  email?: string
  phone?: string
  status?: string
  leadSource?: string
  title?: string
  description?: string
}

export interface SalesforceUpdateLeadResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
    metadata: {
      operation: 'update_lead'
    }
  }
}

export interface SalesforceDeleteLeadParams extends BaseSalesforceParams {
  leadId: string
}

export interface SalesforceDeleteLeadResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: {
      operation: 'delete_lead'
    }
  }
}

export interface SalesforceGetOpportunitiesParams extends BaseSalesforceParams {
  opportunityId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetOpportunitiesResponse {
  success: boolean
  output: {
    opportunity?: any
    opportunities?: any[]
    paging?: SalesforcePaging
    metadata: {
      operation: 'get_opportunities'
      totalReturned?: number
      hasMore?: boolean
    }
    success: boolean
  }
}

export interface SalesforceCreateOpportunityParams extends BaseSalesforceParams {
  name: string
  stageName: string
  closeDate: string
  accountId?: string
  amount?: string
  probability?: string
  description?: string
}

export interface SalesforceCreateOpportunityResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
    metadata: {
      operation: 'create_opportunity'
    }
  }
}

export interface SalesforceUpdateOpportunityParams extends BaseSalesforceParams {
  opportunityId: string
  name?: string
  stageName?: string
  closeDate?: string
  accountId?: string
  amount?: string
  probability?: string
  description?: string
}

export interface SalesforceUpdateOpportunityResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
    metadata: {
      operation: 'update_opportunity'
    }
  }
}

export interface SalesforceDeleteOpportunityParams extends BaseSalesforceParams {
  opportunityId: string
}

export interface SalesforceDeleteOpportunityResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: {
      operation: 'delete_opportunity'
    }
  }
}

export interface SalesforceGetCasesParams extends BaseSalesforceParams {
  caseId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetCasesResponse {
  success: boolean
  output: {
    case?: any
    cases?: any[]
    paging?: SalesforcePaging
    metadata: {
      operation: 'get_cases'
      totalReturned?: number
      hasMore?: boolean
    }
    success: boolean
  }
}

export interface SalesforceCreateCaseParams extends BaseSalesforceParams {
  subject: string
  status?: string
  priority?: string
  origin?: string
  contactId?: string
  accountId?: string
  description?: string
}

export interface SalesforceCreateCaseResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
    metadata: {
      operation: 'create_case'
    }
  }
}

export interface SalesforceUpdateCaseParams extends BaseSalesforceParams {
  caseId: string
  subject?: string
  status?: string
  priority?: string
  description?: string
}

export interface SalesforceUpdateCaseResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
    metadata: {
      operation: 'update_case'
    }
  }
}

export interface SalesforceDeleteCaseParams extends BaseSalesforceParams {
  caseId: string
}

export interface SalesforceDeleteCaseResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: {
      operation: 'delete_case'
    }
  }
}

export interface SalesforceGetTasksParams extends BaseSalesforceParams {
  taskId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetTasksResponse {
  success: boolean
  output: {
    task?: any
    tasks?: any[]
    paging?: SalesforcePaging
    metadata: {
      operation: 'get_tasks'
      totalReturned?: number
      hasMore?: boolean
    }
    success: boolean
  }
}

export interface SalesforceCreateTaskParams extends BaseSalesforceParams {
  subject: string
  status?: string
  priority?: string
  activityDate?: string
  whoId?: string
  whatId?: string
  description?: string
}

export interface SalesforceCreateTaskResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
    metadata: {
      operation: 'create_task'
    }
  }
}

export interface SalesforceUpdateTaskParams extends BaseSalesforceParams {
  taskId: string
  subject?: string
  status?: string
  priority?: string
  activityDate?: string
  description?: string
}

export interface SalesforceUpdateTaskResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
    metadata: {
      operation: 'update_task'
    }
  }
}

export interface SalesforceDeleteTaskParams extends BaseSalesforceParams {
  taskId: string
}

export interface SalesforceDeleteTaskResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: {
      operation: 'delete_task'
    }
  }
}

export interface SalesforceListReportsParams extends BaseSalesforceParams {
  folderName?: string
  searchTerm?: string
}

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

export interface SalesforceGetReportParams extends BaseSalesforceParams {
  reportId: string
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

export interface SalesforceRunReportParams extends BaseSalesforceParams {
  reportId: string
  includeDetails?: string
  filters?: string
}

export interface SalesforceRunReportResponse {
  success: boolean
  output: {
    reportId: string
    reportMetadata?: any
    reportExtendedMetadata?: any
    factMap?: any
    groupingsDown?: any
    groupingsAcross?: any
    hasDetailRows?: boolean
    allData?: boolean
    metadata: {
      operation: 'run_report'
      reportName?: string
      reportFormat?: string
    }
    success: boolean
  }
}

export interface SalesforceListReportTypesParams extends BaseSalesforceParams {}

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

export interface SalesforceListDashboardsParams extends BaseSalesforceParams {
  folderName?: string
}

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

export interface SalesforceGetDashboardParams extends BaseSalesforceParams {
  dashboardId: string
}

export interface SalesforceGetDashboardResponse {
  success: boolean
  output: {
    dashboard: any
    dashboardId: string
    components: any[]
    metadata: {
      operation: 'get_dashboard'
      dashboardName?: string
      folderId?: string
      runningUser?: any
    }
    success: boolean
  }
}

export interface SalesforceRefreshDashboardParams extends BaseSalesforceParams {
  dashboardId: string
}

export interface SalesforceRefreshDashboardResponse {
  success: boolean
  output: {
    dashboard: any
    dashboardId: string
    components: any[]
    status?: any
    metadata: {
      operation: 'refresh_dashboard'
      dashboardName?: string
      refreshDate?: string
    }
    success: boolean
  }
}

export interface SalesforceQueryParams extends BaseSalesforceParams {
  query: string
}

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

export interface SalesforceQueryMoreParams extends BaseSalesforceParams {
  nextRecordsUrl: string
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

export interface SalesforceDescribeObjectParams extends BaseSalesforceParams {
  objectName: string
}

export interface SalesforceDescribeObjectResponse {
  success: boolean
  output: {
    objectName: string
    label?: string
    labelPlural?: string
    fields?: any[]
    keyPrefix?: string
    queryable?: boolean
    createable?: boolean
    updateable?: boolean
    deletable?: boolean
    childRelationships?: any[]
    recordTypeInfos?: any[]
    metadata: {
      operation: 'describe_object'
      fieldCount: number
    }
    success: boolean
  }
}

export interface SalesforceListObjectsParams extends BaseSalesforceParams {}

export interface SalesforceListObjectsResponse {
  success: boolean
  output: {
    objects: any[]
    encoding?: string
    maxBatchSize?: number
    metadata: {
      operation: 'list_objects'
      totalReturned: number
    }
    success: boolean
  }
}

export type SalesforceResponse =
  | SalesforceGetAccountsResponse
  | SalesforceCreateAccountResponse
  | SalesforceUpdateAccountResponse
  | SalesforceDeleteAccountResponse
  | SalesforceGetContactsResponse
  | SalesforceCreateContactResponse
  | SalesforceUpdateContactResponse
  | SalesforceDeleteContactResponse
  | SalesforceGetLeadsResponse
  | SalesforceCreateLeadResponse
  | SalesforceUpdateLeadResponse
  | SalesforceDeleteLeadResponse
  | SalesforceGetOpportunitiesResponse
  | SalesforceCreateOpportunityResponse
  | SalesforceUpdateOpportunityResponse
  | SalesforceDeleteOpportunityResponse
  | SalesforceGetCasesResponse
  | SalesforceCreateCaseResponse
  | SalesforceUpdateCaseResponse
  | SalesforceDeleteCaseResponse
  | SalesforceGetTasksResponse
  | SalesforceCreateTaskResponse
  | SalesforceUpdateTaskResponse
  | SalesforceDeleteTaskResponse
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
