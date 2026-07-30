import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface QuickBooksReference {
  value?: string
  name?: string
}

export interface QuickBooksAddress {
  Id?: string
  Line1?: string
  Line2?: string
  Line3?: string
  Line4?: string
  Line5?: string
  City?: string
  Country?: string
  CountrySubDivisionCode?: string
  PostalCode?: string
  Lat?: string
  Long?: string
}

export interface QuickBooksEmailAddress {
  Address?: string
}

export interface QuickBooksPhoneNumber {
  FreeFormNumber?: string
}

export interface QuickBooksMetaData {
  CreateTime?: string
  LastUpdatedTime?: string
}

export interface QuickBooksCompanyInfo {
  Id: string
  SyncToken?: string
  CompanyName?: string
  LegalName?: string
  CompanyAddr?: QuickBooksAddress
  CustomerCommunicationAddr?: QuickBooksAddress
  LegalAddr?: QuickBooksAddress
  PrimaryPhone?: QuickBooksPhoneNumber
  Email?: QuickBooksEmailAddress
  WebAddr?: { URI?: string }
  CompanyStartDate?: string
  Country?: string
  FiscalYearStartMonth?: string
  SupportedLanguages?: string
  DefaultTimeZone?: string
  NameValue?: Array<{ Name?: string; Value?: string }>
  MetaData?: QuickBooksMetaData
  [key: string]: unknown
}

export interface QuickBooksVendor {
  Id: string
  SyncToken?: string
  DisplayName?: string
  CompanyName?: string
  GivenName?: string
  MiddleName?: string
  FamilyName?: string
  Suffix?: string
  Title?: string
  PrintOnCheckName?: string
  Active?: boolean
  Vendor1099?: boolean
  BillAddr?: QuickBooksAddress
  PrimaryPhone?: QuickBooksPhoneNumber
  Mobile?: QuickBooksPhoneNumber
  Fax?: QuickBooksPhoneNumber
  AlternatePhone?: QuickBooksPhoneNumber
  PrimaryEmailAddr?: QuickBooksEmailAddress
  WebAddr?: { URI?: string }
  Balance?: number
  CurrencyRef?: QuickBooksReference
  AcctNum?: string
  TaxIdentifier?: string
  TermRef?: QuickBooksReference
  MetaData?: QuickBooksMetaData
  sparse?: boolean
  [key: string]: unknown
}

export interface QuickBooksTransaction {
  Id: string
  SyncToken?: string
  DocNumber?: string
  TxnDate?: string
  DueDate?: string
  VendorRef?: QuickBooksReference
  APAccountRef?: QuickBooksReference
  CurrencyRef?: QuickBooksReference
  ExchangeRate?: number
  Line?: Array<Record<string, unknown>>
  TotalAmt?: number
  Balance?: number
  PrivateNote?: string
  TxnTaxDetail?: Record<string, unknown>
  MetaData?: QuickBooksMetaData
  sparse?: boolean
  [key: string]: unknown
}

export type QuickBooksPurchaseOrder = QuickBooksTransaction
export type QuickBooksBill = QuickBooksTransaction

export interface QuickBooksAuthParams {
  accessToken: string
  realmId: string
}

export interface QuickBooksPaginationParams extends QuickBooksAuthParams {
  startPosition: number
  maxResults: number
}

export interface QuickBooksCompanyInfoResponse extends ToolResponse {
  output: {
    company: QuickBooksCompanyInfo
    time: string | null
  }
}

export interface QuickBooksListResponse<T> extends ToolResponse {
  output: {
    items: T[]
    startPosition: number
    maxResults: number
    nextStartPosition: number
    hasMore: boolean
    time: string | null
  }
}

export type QuickBooksResponse =
  | QuickBooksCompanyInfoResponse
  | QuickBooksListResponse<QuickBooksVendor | QuickBooksPurchaseOrder | QuickBooksBill>

export const QUICKBOOKS_REFERENCE_PROPERTIES: Record<string, OutputProperty> = {
  value: { type: 'string', description: 'QuickBooks entity ID', optional: true },
  name: { type: 'string', description: 'QuickBooks entity display name', optional: true },
}

export const QUICKBOOKS_METADATA_PROPERTIES: Record<string, OutputProperty> = {
  CreateTime: { type: 'string', description: 'Entity creation timestamp', optional: true },
  LastUpdatedTime: {
    type: 'string',
    description: 'Entity last-updated timestamp',
    optional: true,
  },
}

export const QUICKBOOKS_COMPANY_INFO_PROPERTIES: Record<string, OutputProperty> = {
  Id: { type: 'string', description: 'Connected QuickBooks company ID' },
  SyncToken: { type: 'string', description: 'CompanyInfo sync token', optional: true },
  CompanyName: { type: 'string', description: 'Company display name', optional: true },
  LegalName: { type: 'string', description: 'Company legal name', optional: true },
  CompanyAddr: { type: 'json', description: 'Company address', optional: true },
  CustomerCommunicationAddr: {
    type: 'json',
    description: 'Customer communication address',
    optional: true,
  },
  LegalAddr: { type: 'json', description: 'Company legal address', optional: true },
  PrimaryPhone: { type: 'json', description: 'Primary phone details', optional: true },
  Email: { type: 'json', description: 'Company email details', optional: true },
  WebAddr: { type: 'json', description: 'Company website details', optional: true },
  CompanyStartDate: {
    type: 'string',
    description: 'Company start date',
    optional: true,
  },
  Country: { type: 'string', description: 'Company country code', optional: true },
  FiscalYearStartMonth: {
    type: 'string',
    description: 'Fiscal year starting month',
    optional: true,
  },
  DefaultTimeZone: {
    type: 'string',
    description: 'Company default time zone',
    optional: true,
  },
  NameValue: {
    type: 'array',
    description: 'QuickBooks company settings represented as name/value entries',
    optional: true,
    items: { type: 'json' },
  },
  MetaData: {
    type: 'json',
    description: 'CompanyInfo creation and update timestamps',
    optional: true,
    properties: QUICKBOOKS_METADATA_PROPERTIES,
  },
}

export const QUICKBOOKS_LIST_OUTPUTS: Record<string, OutputProperty> = {
  startPosition: {
    type: 'number',
    description: 'One-based position of the first item in this response',
  },
  maxResults: {
    type: 'number',
    description: 'Actual number of items reported for this response',
  },
  nextStartPosition: {
    type: 'number',
    description: 'Position to use when explicitly requesting the next page',
  },
  hasMore: {
    type: 'boolean',
    description: 'Conservative indication that another page may exist',
  },
  time: {
    type: 'string',
    description: 'QuickBooks response timestamp',
    optional: true,
    nullable: true,
  },
}
