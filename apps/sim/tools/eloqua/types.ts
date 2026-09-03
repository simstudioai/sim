import type { ToolResponse } from '@/tools/types'

export interface EloquaAuthParams {
  accessToken: string
  instanceUrl: string
}

export interface EloquaApplicationListParams extends EloquaAuthParams {
  count?: number
  depth?: string
  page?: number
  search?: string
  orderBy?: string
  lastUpdatedAt?: number
  viewId?: number
  ownedByUserId?: number
  externalSystemId?: number
  includeCrmIdsMapping?: boolean
  includeAvailable?: boolean
  includeArchived?: boolean
}

export interface EloquaIdParams extends EloquaAuthParams {
  id: string
  depth?: string
  viewId?: number
  externalSystemId?: number
  includeCrmIdsMapping?: boolean
  preMerge?: boolean
  noMergeContent?: boolean
}

export interface EloquaEntityBodyParams<
  TEntity extends EloquaContact | EloquaAccount = EloquaContact | EloquaAccount,
> extends EloquaAuthParams {
  id?: string
  entity: TEntity
}

export interface EloquaCampaignActionParams extends EloquaAuthParams {
  id: string
  scheduledFor?: string
  runAsUserId?: number
  activateNow?: boolean
}

export interface EloquaBulkPageParams extends EloquaAuthParams {
  limit?: number
  offset?: number
  q?: string
  orderBy?: string
  totalResults?: boolean
}

export interface EloquaBulkDefinitionParams<
  TDefinition extends EloquaBulkDefinition = EloquaBulkDefinition,
> extends EloquaAuthParams {
  definition: TDefinition
}

export interface EloquaBulkImportDataParams extends EloquaAuthParams {
  id: string
  data: Array<Record<string, unknown>>
}

export interface EloquaStartSyncParams extends EloquaAuthParams {
  syncedInstanceUri: string
  callbackUrl?: string
}

export interface EloquaBulkSyncParams extends EloquaAuthParams {
  id: string
}

export interface EloquaBulkSyncPageParams extends EloquaBulkSyncParams {
  limit?: number
  offset?: number
  q?: string
  orderBy?: string
  totalResults?: boolean
}

export interface EloquaExtensibleEntity {
  [key: string]: unknown
  type?: string
  id?: string
  currentStatus?: string
  name?: string
  description?: string
  createdBy?: string
  createdAt?: string
  updatedBy?: string
  updatedAt?: string
  depth?: string
}

export interface EloquaContact extends EloquaExtensibleEntity {
  permissions?: string
  firstName?: string
  lastName?: string
  emailAddress?: string
  emailFormatPreference?: string
  isSubscribed?: string
  isBounceback?: string
  accountName?: string
  accountId?: string
  title?: string
  subscriptionDate?: string
  unsubscriptionDate?: string
  bouncebackDate?: string
  fieldValues?: unknown[]
  address1?: string
  address2?: string
  address3?: string
  city?: string
  province?: string
  postalCode?: string
  country?: string
  businessPhone?: string
  mobilePhone?: string
  fax?: string
  salesPerson?: string
}

export interface EloquaAccount extends EloquaExtensibleEntity {
  permissions?: string
  fieldValues?: unknown[]
  address1?: string
  address2?: string
  address3?: string
  city?: string
  province?: string
  postalCode?: string
  country?: string
  businessPhone?: string
  crmSystemMappings?: unknown[]
}

export interface EloquaCampaign extends EloquaExtensibleEntity {
  permissions?: unknown[]
  folderId?: string
  sourceTemplateId?: string
  createdByName?: string
  updatedByName?: string
  scheduledFor?: string
  elements?: unknown[]
  isReadOnly?: string
  runAsUserId?: string
  isExitHistoryDisabled?: string
  isBypassHistoryDisabled?: string
  startAt?: string
  endAt?: string
  budgetedCost?: string
  actualCost?: string
  isMemberAllowedReEntry?: string
  fieldValues?: unknown[]
  campaignType?: string
  product?: string
  region?: string
  clrEndDate?: string
  adCampaignId?: string
  campaignClassification?: string
  referenceProduct?: string
  campaignCategory?: string
  crmId?: string
  crmIds?: unknown[]
  isSyncedWithCRM?: string
  isIncludedInROI?: string
  badgeId?: string
  isEmailMarketingCampaign?: string
  firstActivation?: string
  memberCount?: string
  isUpdatingCrmId?: string
}

export interface EloquaContactList extends EloquaExtensibleEntity {
  permissions?: string
  scope?: string
  count?: string
  membershipAdditions?: unknown[]
  membershipDeletions?: unknown[]
  dataLookupId?: string
}

export interface EloquaSegment extends EloquaExtensibleEntity {
  permissions?: unknown[]
  folderId?: string
  sourceTemplateId?: string
  createdByName?: string
  updatedByName?: string
  scheduledFor?: string
  elements?: unknown[]
  count?: string
  lastCalculatedAt?: string
  isStale?: string
  dependencyName?: string
}

export interface EloquaEmail extends EloquaExtensibleEntity {
  permissions?: unknown[]
  folderId?: string
  sourceTemplateId?: string
  createdByName?: string
  updatedByName?: string
  scheduledFor?: string
  subject?: string
  previewText?: string
  senderName?: string
  senderEmail?: string
  replyToName?: string
  replyToEmail?: string
  bounceBackEmail?: string
  virtualMTAId?: string
  brandId?: string
  htmlContent?: unknown
  plainText?: string
  isPlainTextEditable?: string
  sendPlainTextOnly?: string
  isTracked?: string
  isPrivate?: string
  layout?: string
  style?: string
  forms?: unknown[]
  images?: unknown[]
  hyperlinks?: unknown[]
  contentSections?: unknown[]
  dynamicContents?: unknown[]
  files?: unknown[]
  contentServiceInstances?: unknown[]
  emailHeaderId?: string
  emailFooterId?: string
  emailGroupId?: string
  encodingId?: string
  fieldMerges?: unknown[]
  attachments?: unknown[]
  isContentProtected?: string
  renderMode?: string
  archived?: string
  thumbnailUrl?: string
}

export interface EloquaForm extends EloquaExtensibleEntity {
  permissions?: unknown[]
  folderId?: string
  sourceTemplateId?: string
  createdByName?: string
  updatedByName?: string
  scheduledFor?: string
  htmlName?: string
  processingType?: string
  submitFailedLandingPageId?: string
  size?: unknown
  html?: string
  style?: string
  elements?: unknown[]
  processingSteps?: unknown[]
  defaultKeyFieldMapping?: unknown
  externalIntegrationUrl?: string
  customCSS?: string
  isHidden?: string
  formJson?: string
  isResponsive?: string
  archived?: string
  isFormSpamProtectionEnabled?: string
}

export type EloquaApplicationResource =
  | 'contact'
  | 'account'
  | 'campaign'
  | 'contactList'
  | 'segment'
  | 'email'
  | 'form'

export interface EloquaApplicationResourceMap {
  contact: EloquaContact
  account: EloquaAccount
  campaign: EloquaCampaign
  contactList: EloquaContactList
  segment: EloquaSegment
  email: EloquaEmail
  form: EloquaForm
}

export interface EloquaApplicationListOutput<TEntity> extends Record<string, unknown> {
  items: TEntity[]
  page: number
  pageSize: number
  total: number
  type: string | null
  success: boolean
}

export interface EloquaApplicationItemOutput<TEntity> extends Record<string, unknown> {
  item: TEntity
  success: boolean
}

export interface EloquaContactField {
  createdAt?: string
  createdBy?: string
  dataType?: string
  defaultValue?: string
  hasNotNullConstraint?: boolean
  hasReadOnlyConstraint?: boolean
  hasUniquenessConstraint?: boolean
  internalName?: string
  name?: string
  statement?: string
  updatedAt?: string
  updatedBy?: string
  uri?: string
}

export type EloquaSyncStatus = 'pending' | 'active' | 'success' | 'warning' | 'error'

export interface EloquaSync {
  callbackUrl?: string
  createdAt?: string
  createdBy?: string
  status?: EloquaSyncStatus
  syncedInstanceUri?: string
  syncEndedAt?: string
  syncStartedAt?: string
  uri?: string
}

export interface EloquaSyncLog {
  count?: number
  createdAt?: string
  message?: string
  severity?: string
  statusCode?: string
  syncUri?: string
}

export interface EloquaSyncReject {
  fieldValues?: Record<string, unknown>
  invalidFields?: string[]
  message?: string
  recordIndex?: number
  statusCode?: string
}

export type EloquaBulkItemKind = 'contactField' | 'sync' | 'syncData' | 'syncLog' | 'syncReject'

export interface EloquaBulkItemMap {
  contactField: EloquaContactField
  sync: EloquaSync
  syncData: Record<string, unknown>
  syncLog: EloquaSyncLog
  syncReject: EloquaSyncReject
}

export interface EloquaBulkDefinition {
  [key: string]: unknown
  uri?: string
  name?: string
  fields: Record<string, string>
  autoDeleteDuration?: string
  createdAt?: string
  createdBy?: string
  dataRetentionDuration?: string
  externalSystemId?: number
  kbUsed?: number
  syncActions?: unknown[]
  updatedAt?: string
  updatedBy?: string
}

export interface EloquaContactImportDefinition extends EloquaBulkDefinition {
  identifierFieldName?: string
  importPriorityUri?: string
  importRule?: string
  isSyncTriggeredOnImport?: boolean
  isUpdatingMultipleMatchedRecords?: boolean
  nullIdentifierFieldName?: boolean
  updateRule?: string
  updateRuleByField?: Record<string, string>
}

export interface EloquaContactExportDefinition extends EloquaBulkDefinition {
  areSystemTimestampsInUTC?: boolean
  crmAccountIdField?: string
  filter?: string
  maxRecords?: number
  productIdField?: string
}

export type EloquaBulkDefinitionKind = 'contactImport' | 'contactExport'

export interface EloquaBulkDefinitionMap {
  contactImport: EloquaContactImportDefinition
  contactExport: EloquaContactExportDefinition
}

export interface EloquaBulkPageOutput<TItem> extends Record<string, unknown> {
  items: TItem[]
  count: number
  hasMore: boolean
  limit: number
  offset: number
  totalResults: number | null
  success: boolean
}

export interface EloquaBulkDefinitionOutput<TDefinition> extends Record<string, unknown> {
  definition: TDefinition
  success: boolean
}

export interface EloquaSyncOutput extends Record<string, unknown> {
  sync: EloquaSync
  success: boolean
}

export interface EloquaBulkUploadOutput extends Record<string, unknown> {
  accepted: boolean
  sync: EloquaSync | null
  success: boolean
}

export interface EloquaResponse<TOutput extends Record<string, unknown> = Record<string, unknown>>
  extends ToolResponse {
  output: TOutput
}
