import type { ToolResponse } from '@/tools/types'

export type OracleCustomFields = Record<string, unknown>

export interface OracleB2CServiceAuthParams {
  siteUrl: string
  username: string
  password: string
  applicationContext?: string
}

export interface OracleB2CServiceListParams extends OracleB2CServiceAuthParams {
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  includeTotalResults?: boolean
  pageUrl?: string
}

export interface OracleB2CServiceRecordParams extends OracleB2CServiceAuthParams {
  id: string
}

export interface OracleGetIncidentParams extends OracleB2CServiceRecordParams {
  includeThreads?: boolean
}

export interface OracleNamedId {
  id: string | null
  lookupName: string | null
}

export interface OracleReferenceLink {
  rel: string | null
  href: string | null
}

export interface OracleResourceReference {
  links: OracleReferenceLink[]
}

export interface OracleName {
  first: string | null
  last: string | null
}

export interface OracleEmailAddress {
  address: string | null
  addressType: OracleNamedId | null
}

export interface OraclePhoneNumber {
  number: string | null
  rawNumber: string | null
  phoneType: OracleNamedId | null
}

export interface OracleIncidentThread {
  id: string | null
  text: string | null
  createdTime: string | null
  channel: OracleNamedId | null
  entryType: OracleNamedId | null
}

export interface OracleStatusWithType {
  status: OracleNamedId | null
  statusType: OracleNamedId | null
}

export interface OracleAssignedTo {
  account: OracleResourceReference | null
  staffGroup: OracleNamedId | null
}

export interface OracleIncident {
  id: string | null
  lookupName: string | null
  createdTime: string | null
  updatedTime: string | null
  subject: string | null
  primaryContact: OracleResourceReference | null
  organization: OracleResourceReference | null
  queue: OracleNamedId | null
  severity: OracleNamedId | null
  category: OracleResourceReference | null
  product: OracleResourceReference | null
  statusWithType: OracleStatusWithType | null
  assignedTo: OracleAssignedTo | null
  threads: OracleIncidentThread[]
  customFields: OracleCustomFields | null
}

export interface OracleContact {
  id: string | null
  lookupName: string | null
  createdTime: string | null
  updatedTime: string | null
  name: OracleName | null
  title: string | null
  disabled: boolean | null
  externalReference: string | null
  organization: OracleResourceReference | null
  emails: OracleEmailAddress[]
  phones: OraclePhoneNumber[]
  customFields: OracleCustomFields | null
}

export interface OracleOrganization {
  id: string | null
  lookupName: string | null
  createdTime: string | null
  updatedTime: string | null
  name: string | null
  externalReference: string | null
  parent: OracleResourceReference | null
  industry: OracleNamedId | null
  numberOfEmployees: number | null
  customFields: OracleCustomFields | null
}

export interface OracleAnswer {
  id: string | null
  lookupName: string | null
  createdTime: string | null
  updatedTime: string | null
  answerType: OracleNamedId | null
  language: OracleNamedId | null
  summary: string | null
  question: string | null
  solution: string | null
  keywords: string | null
  statusWithType: OracleStatusWithType | null
  publishOnDate: string | null
  expiresDate: string | null
  customFields: OracleCustomFields | null
}

export type OracleIncidentSummary = Omit<OracleIncident, 'threads' | 'customFields'>
export type OracleContactSummary = Omit<OracleContact, 'emails' | 'phones' | 'customFields'>
export type OracleOrganizationSummary = Omit<OracleOrganization, 'customFields'>
export type OracleAnswerSummary = Omit<OracleAnswer, 'question' | 'solution' | 'customFields'>

export interface OracleContactEmailInput {
  address: string
  addressTypeId: string
}

export interface OracleIncidentWriteFields {
  subject?: string
  primaryContactId?: string
  organizationId?: string
  queueId?: string
  severityId?: string
  categoryId?: string
  productId?: string
  statusId?: string
  assignedAccountId?: string
  assignedStaffGroupId?: string
  customFields?: OracleCustomFields
}

export interface OracleCreateIncidentParams
  extends OracleB2CServiceAuthParams,
    OracleIncidentWriteFields {
  subject: string
  primaryContactId: string
}

export interface OracleUpdateIncidentParams
  extends OracleB2CServiceRecordParams,
    OracleIncidentWriteFields {}

export interface OracleCreateIncidentResponseParams extends OracleB2CServiceAuthParams {
  incidentId: string
  text: string
  subject?: string
  ccEmails?: string[]
  bccEmails?: string[]
  useEmailSignature?: boolean
}

export interface OracleContactWriteFields {
  firstName?: string
  lastName?: string
  title?: string
  organizationId?: string
  externalReference?: string
  disabled?: boolean
  emails?: OracleContactEmailInput[]
  customFields?: OracleCustomFields
}

export interface OracleCreateContactParams
  extends OracleB2CServiceAuthParams,
    OracleContactWriteFields {}

export interface OracleUpdateContactParams
  extends OracleB2CServiceRecordParams,
    OracleContactWriteFields {}

export interface OracleOrganizationWriteFields {
  name?: string
  externalReference?: string
  parentOrganizationId?: string
  industryId?: string
  numberOfEmployees?: number
  customFields?: OracleCustomFields
}

export interface OracleCreateOrganizationParams
  extends OracleB2CServiceAuthParams,
    OracleOrganizationWriteFields {
  name: string
}

export interface OracleUpdateOrganizationParams
  extends OracleB2CServiceRecordParams,
    OracleOrganizationWriteFields {}

export interface OracleAnswerWriteFields {
  answerTypeId?: string
  languageId?: string
  summary?: string
  question?: string
  solution?: string
  keywords?: string
  statusId?: string
  publishOnDate?: string
  expiresDate?: string
  customFields?: OracleCustomFields
}

export interface OracleCreateAnswerParams
  extends OracleB2CServiceAuthParams,
    OracleAnswerWriteFields {
  answerTypeId: string
  languageId: string
  summary: string
}

export interface OracleUpdateAnswerParams
  extends OracleB2CServiceRecordParams,
    OracleAnswerWriteFields {}

export interface OraclePage<T> {
  items: T[]
  count: number
  hasMore: boolean
  totalResults: number | null
  nextPageUrl: string | null
  previousPageUrl: string | null
}

export interface OracleResourceResponse<T> extends ToolResponse {
  output: { resource: T }
}

export interface OraclePageResponse<T> extends ToolResponse {
  output: OraclePage<T>
}

export interface OracleMutationResponse extends ToolResponse {
  output: { id: string; updated?: boolean; deleted?: boolean }
}

export interface OracleIncidentResponseResponse extends ToolResponse {
  output: { incident: OracleNamedId | null; responseSent: true }
}

export type OracleB2CServiceResponse =
  | OracleResourceResponse<OracleIncident | OracleContact | OracleOrganization | OracleAnswer>
  | OraclePageResponse<
      OracleIncidentSummary | OracleContactSummary | OracleOrganizationSummary | OracleAnswerSummary
    >
  | OracleMutationResponse
  | OracleIncidentResponseResponse
