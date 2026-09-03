import { truncate } from '@sim/utils/string'
import { normalizeEloquaInstanceUrl } from '@/lib/oauth/eloqua'
import type {
  EloquaApplicationResource,
  EloquaAuthParams,
  EloquaBulkDefinitionKind,
  EloquaBulkItemKind,
} from '@/tools/eloqua/types'
import type { OAuthConfig, ToolConfig, ToolOutputProperty } from '@/tools/types'

export const ELOQUA_OAUTH_CONFIG = {
  required: true,
  provider: 'eloqua',
  authoritativeParams: ['instanceUrl'],
} as const satisfies OAuthConfig

export const ELOQUA_MAX_INLINE_IMPORT_BYTES = 10 * 1024 * 1024

export const ELOQUA_AUTH_PARAMS: ToolConfig['params'] = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'OAuth access token for Oracle Eloqua',
  },
  instanceUrl: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Trusted Eloqua pod root bound to the selected OAuth credential',
  },
}

export const ELOQUA_ID_PARAM: ToolConfig['params'] = {
  id: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Oracle Eloqua resource ID',
  },
}

export const ELOQUA_APPLICATION_LIST_PARAMS: ToolConfig['params'] = {
  depth: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Response depth: minimal, partial, or complete',
  },
  count: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Number of results in this page (1-1000)',
  },
  page: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'One-based page number',
  },
  search: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: "Eloqua search expression, such as name='Welcome*'",
  },
  orderBy: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Field and direction used to order this page',
  },
  lastUpdatedAt: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Unix timestamp lower bound for the last update time',
  },
}

const stringField = (description: string): ToolOutputProperty => ({
  type: 'string',
  description,
  optional: true,
})

const booleanFieldOutput = (description: string): ToolOutputProperty => ({
  type: 'boolean',
  description,
  optional: true,
})

const numberFieldOutput = (description: string): ToolOutputProperty => ({
  type: 'number',
  description,
  optional: true,
})

const jsonField = (description: string): ToolOutputProperty => ({
  type: 'json',
  description,
  optional: true,
})

const arrayField = (description: string): ToolOutputProperty => ({
  type: 'array',
  description,
  optional: true,
  items: { type: 'json' },
})

const ELOQUA_APPLICATION_COMMON_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: stringField('Eloqua entity type'),
  id: stringField('Eloqua entity ID'),
  currentStatus: stringField('Current entity status'),
  name: stringField('Entity name'),
  description: stringField('Entity description'),
  createdBy: stringField('Login ID that created the entity'),
  createdAt: stringField('Provider creation timestamp'),
  updatedBy: stringField('Login ID that last updated the entity'),
  updatedAt: stringField('Provider update timestamp'),
  depth: stringField('Response detail depth'),
}

export const ELOQUA_APPLICATION_RESOURCE_PROPERTIES: Record<
  EloquaApplicationResource,
  Record<string, ToolOutputProperty>
> = {
  contact: {
    ...ELOQUA_APPLICATION_COMMON_PROPERTIES,
    permissions: stringField('Permissions granted to the current instance'),
    firstName: stringField('Contact first name'),
    lastName: stringField('Contact last name'),
    emailAddress: stringField('Contact email address'),
    emailFormatPreference: stringField('Contact email format preference'),
    isSubscribed: stringField('Whether the contact is subscribed'),
    isBounceback: stringField('Whether the contact has associated bouncebacks'),
    accountName: stringField('Contact account name'),
    accountId: stringField('Contact account ID'),
    title: stringField('Contact title'),
    subscriptionDate: stringField('Contact subscription date'),
    unsubscriptionDate: stringField('Contact unsubscription date'),
    bouncebackDate: stringField('Contact bounceback date'),
    fieldValues: arrayField('Contact custom field values'),
    address1: stringField('First address line'),
    address2: stringField('Second address line'),
    address3: stringField('Third address line'),
    city: stringField('Contact city'),
    province: stringField('Contact province'),
    postalCode: stringField('Contact postal code'),
    country: stringField('Contact country'),
    businessPhone: stringField('Contact business phone'),
    mobilePhone: stringField('Contact mobile phone'),
    fax: stringField('Contact fax number'),
    salesPerson: stringField('Contact account representative'),
  },
  account: {
    ...ELOQUA_APPLICATION_COMMON_PROPERTIES,
    permissions: stringField('Permissions granted to the current instance'),
    fieldValues: arrayField('Account custom field values'),
    address1: stringField('First address line'),
    address2: stringField('Second address line'),
    address3: stringField('Third address line'),
    city: stringField('Account city'),
    province: stringField('Account province'),
    postalCode: stringField('Account postal code'),
    country: stringField('Account country'),
    businessPhone: stringField('Account business phone'),
    crmSystemMappings: arrayField('Linked CRM user mappings'),
  },
  campaign: {
    ...ELOQUA_APPLICATION_COMMON_PROPERTIES,
    permissions: arrayField('Permissions granted to the current instance'),
    folderId: stringField('Containing folder ID'),
    sourceTemplateId: stringField('Source template ID'),
    createdByName: stringField('Name of the user that created the campaign'),
    updatedByName: stringField('Name of the user that last updated the campaign'),
    scheduledFor: stringField('Scheduled activation date'),
    elements: arrayField('Campaign elements'),
    isReadOnly: stringField('Whether the campaign is read-only'),
    runAsUserId: stringField('Campaign execution user ID'),
    isExitHistoryDisabled: stringField('Whether exit history is disabled'),
    isBypassHistoryDisabled: stringField('Whether bypass history is disabled'),
    startAt: stringField('Campaign start time'),
    endAt: stringField('Campaign end time'),
    budgetedCost: stringField('Projected campaign cost'),
    actualCost: stringField('Actual campaign cost'),
    isMemberAllowedReEntry: stringField('Whether members may re-enter'),
    fieldValues: arrayField('Campaign custom field values'),
    campaignType: stringField('Campaign type'),
    product: stringField('Campaign product'),
    region: stringField('Campaign region'),
    clrEndDate: stringField('Campaign CLR end date'),
    adCampaignId: stringField('Advertising campaign ID'),
    campaignClassification: stringField('Campaign classification'),
    referenceProduct: stringField('Reference product'),
    crmId: stringField('CRM campaign ID'),
    crmIds: arrayField('CRM campaign IDs'),
    isSyncedWithCRM: stringField('Whether the campaign is synchronized with CRM'),
    isIncludedInROI: stringField('Whether the campaign is included in ROI'),
    badgeId: stringField('Campaign badge ID'),
    isEmailMarketingCampaign: stringField('Whether this is an email marketing campaign'),
    campaignCategory: stringField('Simple or multi-step campaign category'),
    firstActivation: stringField('Original activation time'),
    memberCount: stringField('Campaign member count'),
    isUpdatingCrmId: stringField('Whether the CRM ID is being updated'),
  },
  contactList: {
    ...ELOQUA_APPLICATION_COMMON_PROPERTIES,
    permissions: stringField('Permissions granted to the current instance'),
    scope: stringField('Local or global contact-list scope'),
    count: stringField('Number of contacts in the list'),
    membershipAdditions: arrayField('Contact membership additions'),
    membershipDeletions: arrayField('Contact membership deletions'),
    dataLookupId: stringField('Contact-list data lookup ID'),
  },
  segment: {
    ...ELOQUA_APPLICATION_COMMON_PROPERTIES,
    permissions: arrayField('Permissions granted to the current instance'),
    folderId: stringField('Containing folder ID'),
    sourceTemplateId: stringField('Source template ID'),
    createdByName: stringField('Name of the user that created the segment'),
    updatedByName: stringField('Name of the user that last updated the segment'),
    scheduledFor: stringField('Segment scheduled date'),
    elements: arrayField('Contact-segment elements'),
    count: stringField('Number of contacts in the segment'),
    lastCalculatedAt: stringField('Most recent segment calculation time'),
    isStale: stringField('Whether the segment is stale'),
    dependencyName: stringField('Segment dependency name'),
  },
  email: {
    ...ELOQUA_APPLICATION_COMMON_PROPERTIES,
    permissions: arrayField('Permissions granted to the current instance'),
    folderId: stringField('Containing folder ID'),
    sourceTemplateId: stringField('Source template ID'),
    createdByName: stringField('Name of the user that created the email'),
    updatedByName: stringField('Name of the user that last updated the email'),
    scheduledFor: stringField('Email scheduled date'),
    subject: stringField('Email subject'),
    previewText: stringField('Email preview text'),
    senderName: stringField('Sender display name'),
    senderEmail: stringField('Sender email address'),
    replyToName: stringField('Reply-to display name'),
    replyToEmail: stringField('Reply-to email address'),
    bounceBackEmail: stringField('Bounce-back email address'),
    virtualMTAId: stringField('Virtual MTA ID'),
    brandId: stringField('Email brand ID'),
    htmlContent: jsonField('HTML content model'),
    plainText: stringField('Plain-text email content'),
    isPlainTextEditable: stringField('Whether plain text is editable'),
    sendPlainTextOnly: stringField('Whether the email sends only plain text'),
    isTracked: stringField('Whether Eloqua tracks the email'),
    isPrivate: stringField('Whether the email is private'),
    layout: stringField('Email layout'),
    style: stringField('Email layout style'),
    forms: arrayField('Associated forms'),
    images: arrayField('Associated images'),
    hyperlinks: arrayField('Contained hyperlinks'),
    contentSections: arrayField('Content sections'),
    dynamicContents: arrayField('Dynamic content assets'),
    files: arrayField('Imported files'),
    contentServiceInstances: arrayField('Content service instances'),
    emailHeaderId: stringField('Email header ID'),
    emailFooterId: stringField('Email footer ID'),
    emailGroupId: stringField('Email group ID'),
    encodingId: stringField('Email encoding ID'),
    fieldMerges: arrayField('Associated field merges'),
    attachments: arrayField('Email attachments'),
    isContentProtected: stringField('Whether protected mode is enabled'),
    renderMode: stringField('Fixed or flow render mode'),
    archived: stringField('Whether the email is archived'),
    thumbnailUrl: stringField('Email thumbnail URL'),
  },
  form: {
    ...ELOQUA_APPLICATION_COMMON_PROPERTIES,
    permissions: arrayField('Permissions granted to the current instance'),
    folderId: stringField('Containing folder ID'),
    sourceTemplateId: stringField('Source template ID'),
    createdByName: stringField('Name of the user that created the form'),
    updatedByName: stringField('Name of the user that last updated the form'),
    scheduledFor: stringField('Form scheduled date'),
    htmlName: stringField('Raw HTML name'),
    processingType: stringField('Form processing type'),
    submitFailedLandingPageId: stringField('Failed-submit landing page ID'),
    size: jsonField('Form dimensions'),
    html: stringField('Raw HTML content'),
    style: stringField('Form layout style'),
    elements: arrayField('Form elements'),
    processingSteps: arrayField('Form processing steps'),
    defaultKeyFieldMapping: jsonField('Default key field mapping'),
    externalIntegrationUrl: stringField('External integration URL'),
    customCSS: stringField('Custom form CSS'),
    isHidden: stringField('Whether the form is hidden'),
    formJson: stringField('Responsive form metadata'),
    isResponsive: stringField('Whether the form is responsive'),
    archived: stringField('Whether the form is archived'),
    isFormSpamProtectionEnabled: stringField('Whether spam protection is enabled'),
  },
}

export function eloquaApplicationListOutputs(
  resource: EloquaApplicationResource
): Record<string, ToolOutputProperty> {
  return {
    items: {
      type: 'array',
      description: `Current page of Eloqua ${resource} entities`,
      items: { type: 'json', properties: ELOQUA_APPLICATION_RESOURCE_PROPERTIES[resource] },
    },
    page: { type: 'number', description: 'Current page number' },
    pageSize: { type: 'number', description: 'Number of entities in the current page' },
    total: { type: 'number', description: 'Total matching entities reported by Eloqua' },
    type: {
      type: 'string',
      description: 'Eloqua query result type',
      optional: true,
      nullable: true,
    },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
  }
}

export function eloquaApplicationItemOutputs(
  resource: EloquaApplicationResource
): Record<string, ToolOutputProperty> {
  return {
    item: {
      type: 'json',
      description: `Oracle Eloqua ${resource} returned by the operation`,
      properties: ELOQUA_APPLICATION_RESOURCE_PROPERTIES[resource],
    },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
  }
}

const ELOQUA_BULK_PAGING_OUTPUTS: Record<string, ToolOutputProperty> = {
  count: { type: 'number', description: 'Number of results returned in this page' },
  hasMore: { type: 'boolean', description: 'Whether Eloqua reports another page' },
  limit: { type: 'number', description: 'Requested page size' },
  offset: { type: 'number', description: 'Requested result offset' },
  totalResults: {
    type: 'number',
    description: 'Total matching results when requested',
    optional: true,
    nullable: true,
  },
}

const ELOQUA_SYNC_PROPERTIES = {
  callbackUrl: { type: 'string', description: 'Completion callback URL', optional: true },
  createdAt: { type: 'string', description: 'Sync creation time', optional: true },
  createdBy: { type: 'string', description: 'Login that created the sync', optional: true },
  status: {
    type: 'string',
    description: 'pending, active, success, warning, or error',
    optional: true,
  },
  syncedInstanceUri: {
    type: 'string',
    description: 'Import or export definition URI',
    optional: true,
  },
  syncEndedAt: { type: 'string', description: 'Sync completion time', optional: true },
  syncStartedAt: { type: 'string', description: 'Sync start time', optional: true },
  uri: { type: 'string', description: 'System-generated sync URI', optional: true },
} as const

const ELOQUA_BULK_ITEM_PROPERTIES: Record<
  Exclude<EloquaBulkItemKind, 'syncData'>,
  Record<string, ToolOutputProperty>
> = {
  contactField: {
    createdAt: stringField('Field creation time'),
    createdBy: stringField('Login that created the field'),
    dataType: stringField('Contact field data type'),
    defaultValue: stringField('Contact field default value'),
    hasNotNullConstraint: booleanFieldOutput('Whether the field disallows null values'),
    hasReadOnlyConstraint: booleanFieldOutput('Whether the field is read-only'),
    hasUniquenessConstraint: booleanFieldOutput('Whether the field must be unique'),
    internalName: stringField('Contact field internal name'),
    name: stringField('Contact field name'),
    statement: stringField('Bulk markup statement for the field'),
    updatedAt: stringField('Field update time'),
    updatedBy: stringField('Login that last updated the field'),
    uri: stringField('System-generated field URI'),
  },
  sync: ELOQUA_SYNC_PROPERTIES,
  syncLog: {
    count: numberFieldOutput('Number of results represented by the log entry'),
    createdAt: stringField('Log creation time'),
    message: stringField('Sync status message'),
    severity: stringField('Sync log severity'),
    statusCode: stringField('Eloqua status code'),
    syncUri: stringField('Synchronization URI'),
  },
  syncReject: {
    fieldValues: jsonField('Rejected record field values'),
    invalidFields: {
      type: 'array',
      description: 'Names of invalid fields',
      optional: true,
      items: { type: 'string' },
    },
    message: stringField('Rejection message'),
    recordIndex: numberFieldOutput('Rejected record index'),
    statusCode: stringField('Eloqua status code'),
  },
}

export function eloquaBulkListOutputs(
  kind: EloquaBulkItemKind
): Record<string, ToolOutputProperty> {
  const properties = kind === 'syncData' ? undefined : ELOQUA_BULK_ITEM_PROPERTIES[kind]
  return {
    items: {
      type: 'array',
      description:
        kind === 'syncData'
          ? 'Current page of records keyed by user-defined Bulk aliases'
          : 'Current page of typed Eloqua Bulk API results',
      items: properties ? { type: 'json', properties } : { type: 'json' },
    },
    ...ELOQUA_BULK_PAGING_OUTPUTS,
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
  }
}

const ELOQUA_BULK_DEFINITION_COMMON_PROPERTIES: Record<string, ToolOutputProperty> = {
  uri: stringField('System-generated definition URI'),
  name: stringField('Definition name'),
  fields: { type: 'json', description: 'Dynamic alias-to-field mapping' },
  autoDeleteDuration: stringField('ISO-8601 duration until the definition is deleted'),
  createdAt: stringField('Definition creation time'),
  createdBy: stringField('Login that created the definition'),
  dataRetentionDuration: stringField('ISO-8601 staging-data retention duration'),
  externalSystemId: numberFieldOutput('External system ID'),
  kbUsed: numberFieldOutput('Staging space used in kilobytes'),
  syncActions: {
    type: 'array',
    description: 'Actions Eloqua applies during synchronization',
    optional: true,
    items: { type: 'json' },
  },
  updatedAt: stringField('Definition update time'),
  updatedBy: stringField('Login that updated the definition'),
}

const ELOQUA_BULK_DEFINITION_PROPERTIES: Record<
  EloquaBulkDefinitionKind,
  Record<string, ToolOutputProperty>
> = {
  contactImport: {
    ...ELOQUA_BULK_DEFINITION_COMMON_PROPERTIES,
    identifierFieldName: stringField('Field used to identify matching contacts'),
    importPriorityUri: stringField('Import priority URI'),
    importRule: stringField('Rule applied when imported data matches existing contacts'),
    isSyncTriggeredOnImport: booleanFieldOutput('Whether upload automatically starts a sync'),
    isUpdatingMultipleMatchedRecords: booleanFieldOutput(
      'Whether imported data updates multiple matching contacts'
    ),
    nullIdentifierFieldName: booleanFieldOutput('Whether to null the identifier field'),
    updateRule: stringField('Default update rule for existing data'),
    updateRuleByField: jsonField('Per-field update rule mapping'),
  },
  contactExport: {
    ...ELOQUA_BULK_DEFINITION_COMMON_PROPERTIES,
    areSystemTimestampsInUTC: booleanFieldOutput('Whether system timestamps export in UTC'),
    crmAccountIdField: stringField('CRM account ID field statement'),
    filter: stringField('Eloqua Markup Language export filter'),
    maxRecords: numberFieldOutput('Maximum records to export'),
    productIdField: stringField('Campaign product ID field statement'),
  },
}

export function eloquaBulkDefinitionOutputs(
  kind: EloquaBulkDefinitionKind
): Record<string, ToolOutputProperty> {
  return {
    definition: {
      type: 'json',
      description: `Created Eloqua Bulk ${kind === 'contactImport' ? 'contact import' : 'contact export'} definition`,
      properties: ELOQUA_BULK_DEFINITION_PROPERTIES[kind],
    },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
  }
}

export const ELOQUA_BULK_SYNC_OUTPUTS: Record<string, ToolOutputProperty> = {
  sync: {
    type: 'json',
    description: 'Eloqua Bulk synchronization',
    properties: ELOQUA_SYNC_PROPERTIES,
  },
  success: { type: 'boolean', description: 'Whether the operation succeeded' },
}

export const ELOQUA_BULK_UPLOAD_OUTPUTS: Record<string, ToolOutputProperty> = {
  accepted: { type: 'boolean', description: 'Whether Eloqua accepted the staged records' },
  sync: {
    type: 'json',
    description: 'Automatically triggered sync when the definition enables it',
    properties: ELOQUA_SYNC_PROPERTIES,
    optional: true,
    nullable: true,
  },
  success: { type: 'boolean', description: 'Whether the operation succeeded' },
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4_096) {
    throw new Error(`${label} must be a non-empty string of at most 4096 characters`)
  }
  return value.trim()
}

export function eloquaResourceId(value: unknown): string {
  const id = requireNonEmptyString(value, 'Eloqua resource ID')
  if (!/^\d+$/.test(id)) throw new Error('Eloqua resource ID must contain only digits')
  return id
}

export function eloquaResourceUri(value: unknown): string {
  const uri = requireNonEmptyString(value, 'Eloqua Bulk resource URI')
  if (!/^\/contacts\/(imports|exports)\/\d+$/.test(uri)) {
    throw new Error('Eloqua Bulk resource URI must identify a contact import or export definition')
  }
  return uri
}

export function eloquaCampaignSchedule(value: unknown): string {
  const scheduledFor = requireNonEmptyString(value, 'Eloqua campaign schedule')
  if (scheduledFor !== 'now' && !/^\d+$/.test(scheduledFor)) {
    throw new Error('Eloqua campaign schedule must be a Unix timestamp or the literal "now"')
  }
  return scheduledFor
}

export function eloquaCallbackUrl(value: unknown): string {
  const callback = requireNonEmptyString(value, 'Eloqua callback URL')
  let url: URL
  try {
    url = new URL(callback)
  } catch {
    throw new Error('Eloqua callback URL must be a valid HTTPS URL')
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Eloqua callback URL must be an HTTPS URL without embedded credentials')
  }
  return url.toString()
}

const ELOQUA_SYNC_STATUSES = new Set(['pending', 'active', 'success', 'warning', 'error'])

export function validateEloquaSync(value: unknown, label: string): Record<string, unknown> {
  const sync = requireEloquaObject(value, label)
  if (
    sync.status !== undefined &&
    (typeof sync.status !== 'string' || !ELOQUA_SYNC_STATUSES.has(sync.status))
  ) {
    throw new Error(`Invalid ${label}: status must be pending, active, success, warning, or error`)
  }
  for (const field of [
    'callbackUrl',
    'createdAt',
    'createdBy',
    'syncedInstanceUri',
    'syncEndedAt',
    'syncStartedAt',
    'uri',
  ]) {
    if (sync[field] !== undefined && typeof sync[field] !== 'string') {
      throw new Error(`Invalid ${label}: ${field} must be a string`)
    }
  }
  return sync
}

export function requireEloquaObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

export function buildEloquaUrl(
  params: EloquaAuthParams,
  path: string,
  query?: Record<string, unknown>
): string {
  const base = normalizeEloquaInstanceUrl(params.instanceUrl)
  const url = new URL(path, base)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

export function eloquaHeaders(params: EloquaAuthParams): Record<string, string> {
  if (!params.accessToken) throw new Error('Eloqua access token is required')
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${params.accessToken}`,
    'Content-Type': 'application/json',
  }
}

export function validateApplicationPagination(count?: number, page?: number): void {
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 1000)) {
    throw new Error('count must be an integer from 1 to 1000')
  }
  if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
    throw new Error('page must be a positive integer')
  }
}

export function validateBulkPagination(
  limit: number | undefined,
  offset: number | undefined,
  maxLimit: 1_000 | 50_000
): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > maxLimit)) {
    throw new Error(`limit must be an integer from 1 to ${maxLimit}`)
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new Error('offset must be a nonnegative integer')
  }
}

export function validateInlineImportData(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || !value.every((item) => requireEloquaObject(item, 'Import row'))) {
    throw new Error('data must be an array of JSON objects')
  }
  const serialized = JSON.stringify(value)
  if (new TextEncoder().encode(serialized).byteLength > ELOQUA_MAX_INLINE_IMPORT_BYTES) {
    throw new Error("Eloqua inline import data exceeds Sim's 10 MiB request limit")
  }
  return value as Array<Record<string, unknown>>
}

export async function eloquaJsonObject(response: Response, label: string) {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new Error(`Invalid ${label} response: expected a JSON object`)
  }
  return requireEloquaObject(value, `${label} response`)
}

export function boundedProviderMessage(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return truncate(value.trim(), 2_000)
}
