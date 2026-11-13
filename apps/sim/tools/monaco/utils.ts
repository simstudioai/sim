import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toArray, toRecord } from '@sim/utils/object'
import type {
  MonacoAccount,
  MonacoAccountCandidate,
  MonacoAccountCompany,
  MonacoAccountDetail,
  MonacoAccountDomainError,
  MonacoAccountWrite,
  MonacoAccountWriteParams,
  MonacoAudience,
  MonacoAudienceContactFailure,
  MonacoCampaign,
  MonacoCampaignDetail,
  MonacoCampaignDistribution,
  MonacoContact,
  MonacoContactDetail,
  MonacoContactWrite,
  MonacoContactWriteParams,
  MonacoConversationDetail,
  MonacoConversationMessage,
  MonacoConversationParticipant,
  MonacoCooldownRule,
  MonacoCurrentUser,
  MonacoEmailRecipient,
  MonacoEnrollFailureReason,
  MonacoEstimatedValue,
  MonacoFieldSchema,
  MonacoMeeting,
  MonacoMeetingDetail,
  MonacoMessageDraft,
  MonacoMessageRow,
  MonacoOpportunity,
  MonacoOpportunityContactLink,
  MonacoOwner,
  MonacoPagination,
  MonacoPipeline,
  MonacoRulesOfEngagement,
  MonacoScoreExplanation,
  MonacoScoreSignal,
  MonacoSequence,
  MonacoSequenceDetail,
  MonacoSequenceTask,
  MonacoStopAndDismissRule,
  MonacoTag,
  MonacoTask,
  MonacoToggleRule,
  MonacoTranscriptSegment,
  MonacoUpdateContactParams,
  MonacoUpsertAccountParams,
  MonacoUpsertContactParams,
  MonacoUser,
} from '@/tools/monaco/types'

/**
 * Base URL for the Monaco Public API.
 * @see https://docs.monaco.com/auth.md
 */
export const MONACO_API_BASE = 'https://api.monaco.com'

const CUSTOM_FIELD_PREFIX = 'custom_field_'

/** Monaco authenticates every request with an `mks_` API key sent as a bearer token. */
export function monacoHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

/**
 * Parses a JSON value that may arrive as a JSON string from a block field or as a
 * structured value from an agent. Empty strings and nullish values become `undefined`.
 */
function parseJsonInput(value: unknown, name: string): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
}

/**
 * Normalizes Monaco list `filters`: a flat array of `{field, condition, value}` rules
 * (implicitly ANDed) or a `{operator, filters}` expression.
 * @see https://docs.monaco.com/pagination-sorting-and-filtering.md
 */
export function parseMonacoFilters(
  value: unknown
): unknown[] | Record<string, unknown> | undefined {
  const parsed = parseJsonInput(value, 'filters')
  if (parsed === undefined) return undefined
  if (Array.isArray(parsed)) return parsed
  if (isRecordLike(parsed) && Array.isArray(parsed.filters)) return parsed
  throw new Error(
    'filters must be an array of {field, condition, value} rules or an {operator, filters} expression'
  )
}

/** Parses an optional JSON object input such as a custom-field map. */
export function parseMonacoObject(
  value: unknown,
  name: string
): Record<string, unknown> | undefined {
  const parsed = parseJsonInput(value, name)
  if (parsed === undefined) return undefined
  if (!isRecordLike(parsed) || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`)
  }
  return parsed
}

/**
 * Normalizes a list of IDs given as an array, a JSON array string, or a comma-separated
 * string. Throws when no ID remains.
 */
export function parseMonacoIdList(value: unknown, name: string): string[] {
  let items: unknown[]
  if (Array.isArray(value)) {
    items = value
  } else if (typeof value === 'string' && value.trim().startsWith('[')) {
    const parsed = parseJsonInput(value, name)
    if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array of IDs`)
    items = parsed
  } else if (typeof value === 'string') {
    items = value.split(',')
  } else {
    throw new Error(`${name} must be a list of IDs`)
  }
  const ids = items.map((item) =>
    typeof item === 'string' ? item.trim() : String(item ?? '').trim()
  )
  const nonEmpty = ids.filter((id) => id.length > 0)
  if (nonEmpty.length === 0) throw new Error(`${name} must contain at least one ID`)
  return nonEmpty
}

/** Builds the JSON body shared by Monaco's `POST /v1/{entity}/list` endpoints, omitting unset fields. */
export function buildMonacoListBody(params: {
  filters?: unknown
  sort?: string
  page?: number
  pageSize?: number
}): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const filters = parseMonacoFilters(params.filters)
  if (filters !== undefined) body.filters = filters
  const sort = params.sort?.trim()
  if (sort) body.sort = sort
  if (params.page !== undefined) body.page = params.page
  if (params.pageSize !== undefined) body.page_size = params.pageSize
  return body
}

/** Appends `page` and `page_size` query parameters for Monaco's GET list endpoints. */
export function withMonacoPageQuery(url: string, page?: number, pageSize?: number): string {
  const query = new URLSearchParams()
  if (page !== undefined) query.set('page', String(page))
  if (pageSize !== undefined) query.set('page_size', String(pageSize))
  const encoded = query.toString()
  return encoded ? `${url}?${encoded}` : url
}

/** Maps Monaco's documented `pagination` object, which every list response carries. */
export function mapMonacoPagination(value: unknown): MonacoPagination {
  const pagination = toRecord(value)
  return {
    page: typeof pagination.page === 'number' ? pagination.page : 1,
    page_size: typeof pagination.page_size === 'number' ? pagination.page_size : 0,
    total_count: typeof pagination.total_count === 'number' ? pagination.total_count : 0,
    total_pages: typeof pagination.total_pages === 'number' ? pagination.total_pages : 0,
  }
}

/**
 * Collects the dynamic `custom_field_<id>` keys Monaco adds to contact, account, and
 * opportunity records into one object.
 */
function collectMonacoCustomFields(record: Record<string, unknown>): Record<string, unknown> {
  const customFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith(CUSTOM_FIELD_PREFIX)) customFields[key] = value
  }
  return customFields
}

/** Returns the value when it is an array of strings, otherwise an empty array. */
export function toMonacoStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/** Maps Monaco's documented `ContactResponse` fields. */
export function mapMonacoContact(value: unknown): MonacoContact {
  const contact = toRecord(value)
  const scoring = isRecordLike(contact.scoring) ? contact.scoring : null
  return {
    id: toStringOrNull(contact.id) ?? '',
    account_id: toStringOrNull(contact.account_id),
    account_name: toStringOrNull(contact.account_name),
    first_name: toStringOrNull(contact.first_name),
    last_name: toStringOrNull(contact.last_name),
    email: toStringOrNull(contact.email),
    title: toStringOrNull(contact.title),
    phone_number: toStringOrNull(contact.phone_number),
    linkedin_url: toStringOrNull(contact.linkedin_url),
    location: toStringOrNull(contact.location),
    country: toStringOrNull(contact.country),
    job_start_date: toStringOrNull(contact.job_start_date),
    source: toStringOrNull(contact.source),
    do_not_contact: contact.do_not_contact === true,
    notes: toStringOrNull(contact.notes),
    scoring: scoring ? { heat_score: toStringOrNull(scoring.heat_score) } : null,
    tags: toMonacoStringArray(contact.tags),
    created_at: toStringOrNull(contact.created_at) ?? '',
    updated_at: toStringOrNull(contact.updated_at) ?? '',
    last_activity_at: toStringOrNull(contact.last_activity_at),
    last_activity_type: toStringOrNull(contact.last_activity_type),
    last_outbound_at: toStringOrNull(contact.last_outbound_at),
    last_outbound_type: toStringOrNull(contact.last_outbound_type),
    last_inbound_at: toStringOrNull(contact.last_inbound_at),
    last_inbound_type: toStringOrNull(contact.last_inbound_type),
    custom_fields: collectMonacoCustomFields(contact),
  }
}

function mapMonacoScoreSignals(value: unknown): MonacoScoreSignal[] {
  return toArray(value).map((item) => {
    const signal = toRecord(item)
    return {
      signal_type: toStringOrNull(signal.signal_type) ?? '',
      signal_point: toStringOrNull(signal.signal_point) ?? '',
    }
  })
}

/** Maps Monaco's documented `ScoreExplanation`, or `null` when the record has none. */
function mapMonacoScoreExplanation(value: unknown): MonacoScoreExplanation | null {
  if (!isRecordLike(value)) return null
  return {
    explanations: mapMonacoScoreSignals(value.explanations),
    firmographic: mapMonacoScoreSignals(value.firmographic),
  }
}

/** Maps Monaco's documented `ContactDetailResponse` fields. */
export function mapMonacoContactDetail(value: unknown): MonacoContactDetail {
  return {
    ...mapMonacoContact(value),
    heat_score_explanation: mapMonacoScoreExplanation(toRecord(value).heat_score_explanation),
  }
}

type MonacoRequestBody = Record<string, unknown>

/** Standard contact fields Monaco can clear (`ContactClearableField`). */
const MONACO_CONTACT_CLEARABLE_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'title',
  'phone_number',
  'linkedin_url',
  'notes',
] as const

/** Standard account fields Monaco can clear (`AccountClearableField`). */
const MONACO_ACCOUNT_CLEARABLE_FIELDS = [
  'name',
  'notes',
  'owner',
  'parent_account',
  'company_id',
  'linkedin_url',
  'description',
  'employee_count',
  'founded_year',
  'estimated_annual_revenue_usd',
  'total_funding_usd',
  'last_funding_round',
  'last_funding_date',
  'industries',
  'business_model',
  'company_status',
  'location',
] as const

/** Company fields Monaco can reset to the linked company's value (`AccountResettableField`). */
const MONACO_ACCOUNT_RESETTABLE_FIELDS = [
  'linkedin_url',
  'description',
  'employee_count',
  'founded_year',
  'estimated_annual_revenue_usd',
  'total_funding_usd',
  'last_funding_round',
  'last_funding_date',
  'industries',
  'business_model',
  'company_status',
  'location',
  'domains',
] as const

function setMonacoString(body: MonacoRequestBody, key: string, value: string | undefined): void {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed) body[key] = trimmed
}

function setMonacoValue(body: MonacoRequestBody, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') body[key] = value
}

function isMonacoEmptyInput(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim())
}

function parseOptionalMonacoList(value: unknown, name: string): string[] | undefined {
  return isMonacoEmptyInput(value) ? undefined : parseMonacoIdList(value, name)
}

/**
 * Parses an optional list where an explicit empty array is meaningful, such as `domains`,
 * where `[]` removes every domain.
 */
function parseMonacoListAllowingEmpty(value: unknown, name: string): string[] | undefined {
  if (isMonacoEmptyInput(value)) return undefined
  if (Array.isArray(value) && value.length === 0) return []
  if (typeof value === 'string' && value.replace(/\s/g, '') === '[]') return []
  return parseMonacoIdList(value, name)
}

/** Parses an optional list of field names and rejects any name outside `allowed`. */
function parseMonacoFieldList<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[]
): T[] | undefined {
  const fields = parseOptionalMonacoList(value, name)
  if (!fields) return undefined
  const allowedSet = new Set<string>(allowed)
  const invalid = fields.filter((field) => !allowedSet.has(field))
  if (invalid.length > 0) {
    throw new Error(`${name} contains unsupported fields: ${invalid.join(', ')}`)
  }
  return fields.filter((field): field is T => allowedSet.has(field))
}

/**
 * Parses a `{custom_field_<id>: value}` object and rejects keys without the
 * `custom_field_` prefix, so custom fields can never overwrite a standard field.
 */
export function parseMonacoCustomFieldInput(value: unknown): Record<string, unknown> {
  const fields = parseMonacoObject(value, 'customFields') ?? {}
  const invalid = Object.keys(fields).filter((key) => !key.startsWith(CUSTOM_FIELD_PREFIX))
  if (invalid.length > 0) {
    throw new Error(
      `customFields keys must start with "${CUSTOM_FIELD_PREFIX}": ${invalid.join(', ')}`
    )
  }
  return fields
}

/**
 * Writes `null` for each cleared field, which is how Monaco's PATCH endpoints clear a value.
 * Throws when a field is both set and cleared in the same request.
 */
function applyMonacoPatchClears(body: MonacoRequestBody, fields: string[] | undefined): void {
  for (const field of fields ?? []) {
    if (body[field] !== undefined) {
      throw new Error(`${field} cannot be both set and listed in clearFields`)
    }
    body[field] = null
  }
}

/** Builds the `ContactCreateRequest` fields shared by contact create and upsert. */
function buildMonacoContactWriteBody(params: MonacoContactWriteParams): MonacoRequestBody {
  const body: MonacoRequestBody = { ...parseMonacoCustomFieldInput(params.customFields) }
  setMonacoString(body, 'email', params.email)
  setMonacoString(body, 'linkedin_url', params.linkedinUrl)
  setMonacoString(body, 'first_name', params.firstName)
  setMonacoString(body, 'last_name', params.lastName)
  setMonacoString(body, 'title', params.title)
  setMonacoString(body, 'phone_number', params.phoneNumber)
  setMonacoString(body, 'location', params.location)
  setMonacoString(body, 'account_id', params.accountId)
  setMonacoString(body, 'domain', params.domain)
  setMonacoValue(body, 'do_not_contact', params.doNotContact)
  setMonacoString(body, 'notes', params.notes)
  setMonacoValue(body, 'tags', parseOptionalMonacoList(params.tags, 'tags'))
  if (params.isInbound === true) body.is_inbound = true
  return body
}

/** Builds a `POST /v1/contacts/` body, which needs an email or LinkedIn URL. */
export function buildMonacoCreateContactBody(params: MonacoContactWriteParams): MonacoRequestBody {
  const body = buildMonacoContactWriteBody(params)
  if (body.email === undefined && body.linkedin_url === undefined) {
    throw new Error('Provide an email or LinkedIn URL to create a contact')
  }
  return body
}

/**
 * Builds a `PUT /v1/contacts/` body. With `id` the contact is updated by ID, which Monaco
 * forbids combining with `account_id`, `domain`, `location`, or `is_inbound`.
 */
export function buildMonacoUpsertContactBody(params: MonacoUpsertContactParams): MonacoRequestBody {
  const body = buildMonacoContactWriteBody(params)
  const clearFields = parseMonacoFieldList(
    params.clearFields,
    'clearFields',
    MONACO_CONTACT_CLEARABLE_FIELDS
  )
  const id = params.id?.trim()
  if (id) {
    const disallowed = ['account_id', 'domain', 'location', 'is_inbound'].filter(
      (key) => body[key] !== undefined
    )
    if (disallowed.length > 0) {
      throw new Error(`${disallowed.join(', ')} cannot be used when updating a contact by ID`)
    }
    body.id = id
    if (clearFields) body.clear_fields = clearFields
    return body
  }
  if (clearFields) throw new Error('clearFields only applies when a contact ID is given')
  if (body.email === undefined && body.linkedin_url === undefined) {
    throw new Error('Provide an email, LinkedIn URL, or contact ID to upsert a contact')
  }
  return body
}

/** Builds a `PATCH /v1/contacts/{contact_id}` body from the fields the caller set. */
export function buildMonacoUpdateContactBody(params: MonacoUpdateContactParams): MonacoRequestBody {
  const body: MonacoRequestBody = { ...parseMonacoCustomFieldInput(params.customFields) }
  setMonacoString(body, 'first_name', params.firstName)
  setMonacoString(body, 'last_name', params.lastName)
  setMonacoString(body, 'email', params.email)
  setMonacoString(body, 'title', params.title)
  setMonacoString(body, 'phone_number', params.phoneNumber)
  setMonacoString(body, 'linkedin_url', params.linkedinUrl)
  setMonacoString(body, 'location', params.location)
  setMonacoString(body, 'notes', params.notes)
  setMonacoValue(body, 'do_not_contact', params.doNotContact)
  setMonacoValue(body, 'tags', parseOptionalMonacoList(params.tags, 'tags'))
  setMonacoString(body, 'country', params.country)
  setMonacoString(body, 'job_start_date', params.jobStartDate)
  applyMonacoPatchClears(
    body,
    parseMonacoFieldList(params.clearFields, 'clearFields', MONACO_CONTACT_CLEARABLE_FIELDS)
  )
  if (Object.keys(body).length === 0) throw new Error('Provide at least one field to update')
  return body
}

/** Builds the account and company fields shared by account update and upsert. */
function buildMonacoAccountWriteBody(params: MonacoAccountWriteParams): MonacoRequestBody {
  const body: MonacoRequestBody = {}
  setMonacoString(body, 'name', params.name)
  setMonacoString(body, 'status', params.status)
  setMonacoString(body, 'notes', params.notes)
  setMonacoString(body, 'owner', params.owner)
  setMonacoValue(body, 'tags', parseOptionalMonacoList(params.tags, 'tags'))
  setMonacoString(body, 'parent_account', params.parentAccount)
  setMonacoString(body, 'company_id', params.companyId)
  setMonacoValue(body, 'replace_edited_fields', params.replaceEditedFields)
  setMonacoString(body, 'linkedin_url', params.linkedinUrl)
  setMonacoString(body, 'description', params.description)
  setMonacoValue(body, 'employee_count', params.employeeCount)
  setMonacoValue(body, 'founded_year', params.foundedYear)
  setMonacoValue(body, 'estimated_annual_revenue_usd', params.estimatedAnnualRevenueUsd)
  setMonacoValue(body, 'total_funding_usd', params.totalFundingUsd)
  setMonacoString(body, 'last_funding_round', params.lastFundingRound)
  setMonacoString(body, 'last_funding_date', params.lastFundingDate)
  setMonacoValue(body, 'industries', parseOptionalMonacoList(params.industries, 'industries'))
  setMonacoString(body, 'business_model', params.businessModel)
  setMonacoString(body, 'company_status', params.companyStatus)
  setMonacoString(body, 'location', params.location)
  setMonacoValue(body, 'domains', parseMonacoListAllowingEmpty(params.domains, 'domains'))
  setMonacoValue(
    body,
    'reset_fields',
    parseMonacoFieldList(params.resetFields, 'resetFields', MONACO_ACCOUNT_RESETTABLE_FIELDS)
  )
  return body
}

/** Builds a `PATCH /v1/accounts/{account_id}` body from the fields the caller set. */
export function buildMonacoUpdateAccountBody(params: MonacoAccountWriteParams): MonacoRequestBody {
  const body: MonacoRequestBody = {
    ...parseMonacoCustomFieldInput(params.customFields),
    ...buildMonacoAccountWriteBody(params),
  }
  applyMonacoPatchClears(
    body,
    parseMonacoFieldList(params.clearFields, 'clearFields', MONACO_ACCOUNT_CLEARABLE_FIELDS)
  )
  if (Object.keys(body).length === 0) throw new Error('Provide at least one field to update')
  return body
}

/**
 * Builds a `PUT /v1/accounts/` body. Matching uses `domain_lookup` (never the deprecated
 * `domain`); with `id` the account is updated by ID, and only then may `domains`,
 * `clear_fields`, and `reset_fields` be sent.
 */
export function buildMonacoUpsertAccountBody(params: MonacoUpsertAccountParams): MonacoRequestBody {
  const body: MonacoRequestBody = {
    ...parseMonacoCustomFieldInput(params.customFields),
    ...buildMonacoAccountWriteBody(params),
  }
  const clearFields = parseMonacoFieldList(
    params.clearFields,
    'clearFields',
    MONACO_ACCOUNT_CLEARABLE_FIELDS
  )
  const id = params.id?.trim()
  const domainLookup = params.domainLookup?.trim()
  if (id) {
    if (domainLookup) throw new Error('domainLookup cannot be used when updating an account by ID')
    body.id = id
    if (clearFields) body.clear_fields = clearFields
    return body
  }
  const idOnly = ['domains', 'reset_fields'].filter((key) => body[key] !== undefined)
  if (clearFields) idOnly.push('clear_fields')
  if (idOnly.length > 0) {
    throw new Error(`${idOnly.join(', ')} only apply when an account ID is given`)
  }
  if (domainLookup) {
    body.domain_lookup = domainLookup
  } else if (body.name === undefined) {
    throw new Error('Provide a domain lookup, an account ID, or a name to upsert an account')
  }
  return body
}

/** Maps Monaco's documented `ContactWriteResponse` fields. */
export function mapMonacoContactWrite(value: unknown): MonacoContactWrite {
  return {
    ...mapMonacoContact(value),
    enrichment_status: toStringOrNull(toRecord(value).enrichment_status),
  }
}

function mapMonacoAccountCompany(value: unknown): MonacoAccountCompany | null {
  if (!isRecordLike(value)) return null
  return {
    domain: toStringOrNull(value.domain),
    linkedin_url: toStringOrNull(value.linkedin_url),
    description: toStringOrNull(value.description),
    employee_count: toNumberOrNull(value.employee_count),
    founded_year: toNumberOrNull(value.founded_year),
    industries: toMonacoStringArray(value.industries),
    total_funding_usd: toNumberOrNull(value.total_funding_usd),
    last_funding_date: toStringOrNull(value.last_funding_date),
    company_name: toStringOrNull(value.company_name),
    estimated_annual_revenue_usd: toNumberOrNull(value.estimated_annual_revenue_usd),
    last_funding_round: toStringOrNull(value.last_funding_round),
    business_model: toStringOrNull(value.business_model),
    company_status: toStringOrNull(value.company_status),
    location: toStringOrNull(value.location),
  }
}

/** Maps Monaco's documented `AccountResponse` fields. */
export function mapMonacoAccount(value: unknown): MonacoAccount {
  const account = toRecord(value)
  const owner = isRecordLike(account.owner) ? account.owner : null
  const parent = isRecordLike(account.parent_account) ? account.parent_account : null
  const scoring = isRecordLike(account.scoring) ? account.scoring : null
  return {
    id: toStringOrNull(account.id) ?? '',
    name: toStringOrNull(account.name),
    status: toStringOrNull(account.status),
    owner: owner
      ? {
          id: toStringOrNull(owner.id) ?? '',
          first_name: toStringOrNull(owner.first_name),
          last_name: toStringOrNull(owner.last_name),
        }
      : null,
    parent_account: parent
      ? { id: toStringOrNull(parent.id) ?? '', name: toStringOrNull(parent.name) }
      : null,
    notes: toStringOrNull(account.notes),
    domains: toMonacoStringArray(account.domains),
    company: mapMonacoAccountCompany(account.company),
    overridden_fields: toMonacoStringArray(account.overridden_fields),
    scoring: scoring
      ? { tier: toStringOrNull(scoring.tier), heat_score: toStringOrNull(scoring.heat_score) }
      : null,
    tags: toMonacoStringArray(account.tags),
    created_at: toStringOrNull(account.created_at) ?? '',
    updated_at: toStringOrNull(account.updated_at) ?? '',
    last_activity_at: toStringOrNull(account.last_activity_at),
    last_activity_type: toStringOrNull(account.last_activity_type),
    last_contacted_at: toStringOrNull(account.last_contacted_at),
    last_contacted_type: toStringOrNull(account.last_contacted_type),
    last_inbound_at: toStringOrNull(account.last_inbound_at),
    last_inbound_type: toStringOrNull(account.last_inbound_type),
    custom_fields: collectMonacoCustomFields(account),
  }
}

/** Maps Monaco's documented `AccountDetailResponse` fields. */
export function mapMonacoAccountDetail(value: unknown): MonacoAccountDetail {
  return {
    ...mapMonacoAccount(value),
    heat_score_explanation: mapMonacoScoreExplanation(toRecord(value).heat_score_explanation),
  }
}

function mapMonacoAccountDomainError(value: unknown): MonacoAccountDomainError {
  const error = toRecord(value)
  return {
    domain: toStringOrNull(error.domain) ?? '',
    reason: toStringOrNull(error.reason) ?? '',
    account_id: toStringOrNull(error.account_id),
    account_name: toStringOrNull(error.account_name),
  }
}

/** Maps Monaco's documented `AccountWriteResponse` fields. */
export function mapMonacoAccountWrite(value: unknown): MonacoAccountWrite {
  const skipped = toRecord(value).skipped_domains
  return {
    ...mapMonacoAccount(value),
    skipped_domains: Array.isArray(skipped) ? skipped.map(mapMonacoAccountDomainError) : null,
  }
}

function mapMonacoOwner(value: unknown): MonacoOwner | null {
  if (!isRecordLike(value)) return null
  return {
    id: toStringOrNull(value.id) ?? '',
    first_name: toStringOrNull(value.first_name),
    last_name: toStringOrNull(value.last_name),
  }
}

function mapMonacoEstimatedValue(value: unknown): MonacoEstimatedValue | null {
  if (!isRecordLike(value)) return null
  return {
    currency_code: toStringOrNull(value.currency_code),
    amount: toNumberOrNull(value.amount),
    amount_precise: toNumberOrNull(value.amount_precise),
  }
}

/** Maps Monaco's documented `OpportunityResponse` (and identical `OpportunityDetailResponse`) fields. */
export function mapMonacoOpportunity(value: unknown): MonacoOpportunity {
  const opportunity = toRecord(value)
  return {
    id: toStringOrNull(opportunity.id) ?? '',
    account_id: toStringOrNull(opportunity.account_id) ?? '',
    name: toStringOrNull(opportunity.name),
    owner: mapMonacoOwner(opportunity.owner),
    stage: toStringOrNull(opportunity.stage),
    stage_id: toStringOrNull(opportunity.stage_id),
    pipeline_id: toStringOrNull(opportunity.pipeline_id),
    pipeline_name: toStringOrNull(opportunity.pipeline_name),
    estimated_value: mapMonacoEstimatedValue(opportunity.estimated_value),
    estimated_close_date: toStringOrNull(opportunity.estimated_close_date),
    actual_close_date: toStringOrNull(opportunity.actual_close_date),
    summary: toStringOrNull(opportunity.summary),
    risks: toMonacoStringArray(opportunity.risks),
    notes: toStringOrNull(opportunity.notes),
    tags: toMonacoStringArray(opportunity.tags),
    contact_ids: toMonacoStringArray(opportunity.contact_ids),
    last_activity_at: toStringOrNull(opportunity.last_activity_at),
    updated_at: toStringOrNull(opportunity.updated_at),
    created_at: toStringOrNull(opportunity.created_at) ?? '',
    custom_fields: collectMonacoCustomFields(opportunity),
  }
}

/** Maps Monaco's documented `OpportunityContactLinkResponse` fields. */
export function mapMonacoOpportunityContactLink(value: unknown): MonacoOpportunityContactLink {
  const link = toRecord(value)
  return {
    contact_id: toStringOrNull(link.contact_id) ?? '',
    source: toStringOrNull(link.source) ?? '',
    created_at: toStringOrNull(link.created_at) ?? '',
    email: toStringOrNull(link.email),
    first_name: toStringOrNull(link.first_name),
    last_name: toStringOrNull(link.last_name),
    title: toStringOrNull(link.title),
    account_id: toStringOrNull(link.account_id),
  }
}

/** Maps Monaco's documented `PipelineResponse` fields, including its stages. */
export function mapMonacoPipeline(value: unknown): MonacoPipeline {
  const pipeline = toRecord(value)
  return {
    id: toStringOrNull(pipeline.id) ?? '',
    name: toStringOrNull(pipeline.name) ?? '',
    is_default: pipeline.is_default === true,
    stages: toArray(pipeline.stages).map((item) => {
      const stage = toRecord(item)
      return {
        id: toStringOrNull(stage.id) ?? '',
        key: toStringOrNull(stage.key) ?? '',
        display_name: toStringOrNull(stage.display_name) ?? '',
      }
    }),
  }
}

/**
 * Builds the fields shared by Monaco's opportunity create and update bodies, omitting unset and
 * blank values. The amount is sent as `amount_precise`, since Monaco deprecates `amount`.
 */
export function buildMonacoOpportunityWriteBody(params: {
  name?: string
  ownerUserId?: string
  stage?: string
  stageId?: string
  pipelineId?: string
  currencyCode?: string
  amount?: number
  estimatedCloseDate?: string
  actualCloseDate?: string
  notes?: string
  tags?: unknown
}): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const strings: Array<[string, string | undefined]> = [
    ['name', params.name],
    ['owner_user_id', params.ownerUserId],
    ['stage', params.stage],
    ['stage_id', params.stageId],
    ['pipeline_id', params.pipelineId],
    ['estimated_close_date', params.estimatedCloseDate],
    ['actual_close_date', params.actualCloseDate],
  ]
  for (const [key, value] of strings) {
    const trimmed = value?.trim()
    if (trimmed) body[key] = trimmed
  }
  if (params.notes?.trim()) body.notes = params.notes

  const currencyCode = params.currencyCode?.trim()
  const hasAmount = params.amount !== undefined
  if (hasAmount !== Boolean(currencyCode)) {
    throw new Error(
      'Set amount and currencyCode together: Monaco stores them as one estimated_value object, and a partial update could clear the other half'
    )
  }
  if (hasAmount && currencyCode) {
    body.estimated_value = { currency_code: currencyCode, amount_precise: params.amount }
  }

  const hasTags =
    params.tags !== undefined &&
    params.tags !== null &&
    !(typeof params.tags === 'string' && params.tags.trim() === '')
  if (hasTags) body.tags = parseMonacoIdList(params.tags, 'tags')

  return body
}

function mapMonacoEmailRecipients(value: unknown): MonacoEmailRecipient[] {
  return toArray(value).map((item) => {
    const recipient = toRecord(item)
    return {
      name: toStringOrNull(recipient.name) ?? '',
      email: toStringOrNull(recipient.email) ?? '',
    }
  })
}

function mapMonacoMessageDraft(value: unknown): MonacoMessageDraft | null {
  if (!isRecordLike(value)) return null
  return {
    recipients: mapMonacoEmailRecipients(value.recipients),
    cc: Array.isArray(value.cc) ? mapMonacoEmailRecipients(value.cc) : null,
    subject: toStringOrNull(value.subject) ?? '',
    body: toStringOrNull(value.body) ?? '',
    sent_at: toStringOrNull(value.sent_at),
  }
}

/** Maps Monaco's documented `TaskResponse` fields. */
export function mapMonacoTask(value: unknown): MonacoTask {
  const task = toRecord(value)
  const assignee = isRecordLike(task.assignee) ? task.assignee : null
  return {
    id: toStringOrNull(task.id) ?? '',
    account_id: toStringOrNull(task.account_id),
    opportunity_id: toStringOrNull(task.opportunity_id),
    title: toStringOrNull(task.title),
    description: toStringOrNull(task.description),
    task_type: toStringOrNull(task.task_type),
    assignee: assignee
      ? {
          id: toStringOrNull(assignee.id) ?? '',
          first_name: toStringOrNull(assignee.first_name),
          last_name: toStringOrNull(assignee.last_name),
        }
      : null,
    status: toStringOrNull(task.status),
    due_at: toStringOrNull(task.due_at),
    completed_at: toStringOrNull(task.completed_at),
    created_at: toStringOrNull(task.created_at) ?? '',
    updated_at: toStringOrNull(task.updated_at) ?? '',
    message_draft: mapMonacoMessageDraft(task.message_draft),
  }
}

function mapMonacoAccountCandidates(value: unknown): MonacoAccountCandidate[] {
  return toArray(value).map((item) => {
    const candidate = toRecord(item)
    return {
      account_id: toStringOrNull(candidate.account_id) ?? '',
      name: toStringOrNull(candidate.name),
    }
  })
}

/** Maps Monaco's documented `MeetingResponse` fields. */
export function mapMonacoMeeting(value: unknown): MonacoMeeting {
  const meeting = toRecord(value)
  const organizer = isRecordLike(meeting.organizer) ? meeting.organizer : null
  return {
    id: toStringOrNull(meeting.id) ?? '',
    account_id: toStringOrNull(meeting.account_id),
    account_candidates: mapMonacoAccountCandidates(meeting.account_candidates),
    opportunity_id: toStringOrNull(meeting.opportunity_id),
    opportunity_candidates: toArray(meeting.opportunity_candidates).map((item) => {
      const candidate = toRecord(item)
      return {
        opportunity_id: toStringOrNull(candidate.opportunity_id) ?? '',
        name: toStringOrNull(candidate.name),
      }
    }),
    title: toStringOrNull(meeting.title),
    description: toStringOrNull(meeting.description),
    start_time: toStringOrNull(meeting.start_time),
    end_time: toStringOrNull(meeting.end_time),
    occurred_at: toStringOrNull(meeting.occurred_at),
    meeting_platform: toStringOrNull(meeting.meeting_platform),
    meeting_url: toStringOrNull(meeting.meeting_url),
    organizer: organizer
      ? {
          email: toStringOrNull(organizer.email),
          display_name: toStringOrNull(organizer.display_name),
        }
      : null,
    attendees: toArray(meeting.attendees).map((item) => {
      const attendee = toRecord(item)
      return {
        email: toStringOrNull(attendee.email),
        display_name: toStringOrNull(attendee.display_name),
        response_status: toStringOrNull(attendee.response_status),
      }
    }),
    next_actions: Array.isArray(meeting.next_actions)
      ? toMonacoStringArray(meeting.next_actions)
      : null,
    created_at: toStringOrNull(meeting.created_at),
    updated_at: toStringOrNull(meeting.updated_at),
  }
}

function mapMonacoTranscript(value: unknown): MonacoTranscriptSegment[] | null {
  if (!Array.isArray(value)) return null
  return value.map((item) => {
    const segment = toRecord(item)
    return {
      speaker: toStringOrNull(segment.speaker) ?? '',
      language: toStringOrNull(segment.language) ?? '',
      words: toArray(segment.words).map((wordItem) => {
        const word = toRecord(wordItem)
        return {
          text: toStringOrNull(word.text) ?? '',
          start_timestamp: toNumberOrNull(word.start_timestamp) ?? 0,
          end_timestamp: toNumberOrNull(word.end_timestamp) ?? 0,
        }
      }),
    }
  })
}

/** Maps Monaco's documented `MeetingDetailResponse` fields, including the full transcript. */
export function mapMonacoMeetingDetail(value: unknown): MonacoMeetingDetail {
  const meeting = toRecord(value)
  return {
    ...mapMonacoMeeting(meeting),
    ai_premeeting_notes: toStringOrNull(meeting.ai_premeeting_notes),
    meeting_summary: toStringOrNull(meeting.meeting_summary),
    video_url: toStringOrNull(meeting.video_url),
    transcript: mapMonacoTranscript(meeting.transcript),
    transcript_source: toStringOrNull(meeting.transcript_source),
  }
}

/** Maps Monaco's documented `MessageRow` fields from `POST /v1/messages/list`. */
export function mapMonacoMessageRow(value: unknown): MonacoMessageRow {
  const row = toRecord(value)
  return {
    conversation_id: toStringOrNull(row.conversation_id) ?? '',
    channel: toStringOrNull(row.channel) ?? '',
    direction: toStringOrNull(row.direction) ?? '',
    subject: toStringOrNull(row.subject),
    preview: toStringOrNull(row.preview) ?? '',
    timestamp: toStringOrNull(row.timestamp) ?? '',
    contact_id: toStringOrNull(row.contact_id),
    account_id: toStringOrNull(row.account_id),
  }
}

function mapMonacoConversationParticipant(value: unknown): MonacoConversationParticipant {
  const participant = toRecord(value)
  return {
    name: toStringOrNull(participant.name) ?? '',
    email: toStringOrNull(participant.email),
    linkedin_url: toStringOrNull(participant.linkedin_url),
    contact_id: toStringOrNull(participant.contact_id),
    company_name: toStringOrNull(participant.company_name),
    is_current_user: participant.is_current_user === true,
  }
}

function mapMonacoParticipantList(value: unknown): MonacoConversationParticipant[] | null {
  return Array.isArray(value) ? value.map(mapMonacoConversationParticipant) : null
}

function mapMonacoConversationMessage(value: unknown): MonacoConversationMessage {
  const message = toRecord(value)
  return {
    id: toStringOrNull(message.id) ?? '',
    channel: toStringOrNull(message.channel) ?? '',
    sender: mapMonacoConversationParticipant(message.sender),
    to: mapMonacoParticipantList(message.to),
    cc: mapMonacoParticipantList(message.cc),
    bcc: mapMonacoParticipantList(message.bcc),
    subject: toStringOrNull(message.subject),
    body: toStringOrNull(message.body) ?? '',
    body_truncated: message.body_truncated === true,
    timestamp: toStringOrNull(message.timestamp) ?? '',
  }
}

/** Maps Monaco's documented `ConversationDetailResponse` fields. */
export function mapMonacoConversationDetail(value: unknown): MonacoConversationDetail {
  const conversation = toRecord(value)
  return {
    id: toStringOrNull(conversation.id) ?? '',
    channel: toStringOrNull(conversation.channel) ?? '',
    subject: toStringOrNull(conversation.subject),
    participants: toArray(conversation.participants).map(mapMonacoConversationParticipant),
    account_id: toStringOrNull(conversation.account_id),
    account_candidates: mapMonacoAccountCandidates(conversation.account_candidates),
    messages: toArray(conversation.messages).map(mapMonacoConversationMessage),
    message_pagination: mapMonacoPagination(conversation.message_pagination),
  }
}

/** Maps Monaco's documented `TagResponse` fields. */
export function mapMonacoTag(value: unknown): MonacoTag {
  const tag = toRecord(value)
  return {
    id: toStringOrNull(tag.id) ?? '',
    name: toStringOrNull(tag.name) ?? '',
    color: toStringOrNull(tag.color),
  }
}

/** Maps Monaco's documented `UserResponse` fields. */
export function mapMonacoUser(value: unknown): MonacoUser {
  const user = toRecord(value)
  return {
    id: toStringOrNull(user.id) ?? '',
    first_name: toStringOrNull(user.first_name),
    last_name: toStringOrNull(user.last_name),
    email: toStringOrNull(user.email),
    role: toStringOrNull(user.role) ?? '',
  }
}

/** Maps Monaco's documented `MeResponse` fields. */
export function mapMonacoCurrentUser(value: unknown): MonacoCurrentUser {
  const me = toRecord(value)
  return {
    org_id: toStringOrNull(me.org_id) ?? '',
    user_id: toStringOrNull(me.user_id) ?? '',
    user_email: toStringOrNull(me.user_email),
    user_first_name: toStringOrNull(me.user_first_name),
    user_last_name: toStringOrNull(me.user_last_name),
    org_name: toStringOrNull(me.org_name),
  }
}

/** Maps Monaco's documented `FieldSchemaResponse` fields. */
export function mapMonacoFieldSchema(value: unknown): MonacoFieldSchema {
  const field = toRecord(value)
  const customSettings = isRecordLike(field.custom_field_settings)
    ? field.custom_field_settings
    : null
  const enumSettings = isRecordLike(field.enum_field_settings) ? field.enum_field_settings : null
  return {
    name: toStringOrNull(field.name) ?? '',
    key: toStringOrNull(field.key) ?? '',
    type: toStringOrNull(field.type) ?? '',
    parent: toStringOrNull(field.parent),
    filterable: field.filterable === true,
    sortable: field.sortable === true,
    updatable: field.updatable === true,
    allowed_operators: toMonacoStringArray(field.allowed_operators),
    custom_field_settings: customSettings
      ? {
          id: toStringOrNull(customSettings.id) ?? '',
          is_ai_auto_filled: customSettings.is_ai_auto_filled === true,
          question: toStringOrNull(customSettings.question),
        }
      : null,
    enum_field_settings: enumSettings
      ? {
          allowed_values: toArray(enumSettings.allowed_values).map((item) => {
            const option = toRecord(item)
            return {
              key: toStringOrNull(option.key) ?? '',
              display_value: toStringOrNull(option.display_value) ?? '',
            }
          }),
        }
      : null,
  }
}

/**
 * Like `parseMonacoIdList`, but returns `undefined` when the optional input is unset or an
 * empty string instead of throwing.
 */
export function parseMonacoOptionalIdList(value: unknown, name: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  if (Array.isArray(value) && value.length === 0) return undefined
  return parseMonacoIdList(value, name)
}

/** Maps Monaco's documented `SequenceResponse` fields. */
export function mapMonacoSequence(value: unknown): MonacoSequence {
  const sequence = toRecord(value)
  const exclusion = isRecordLike(sequence.exclusion_info) ? sequence.exclusion_info : null
  return {
    id: toStringOrNull(sequence.id) ?? '',
    contact_id: toStringOrNull(sequence.contact_id) ?? '',
    name: toStringOrNull(sequence.name),
    description: toStringOrNull(sequence.description),
    status: toStringOrNull(sequence.status),
    template_id: toStringOrNull(sequence.template_id),
    created_at: toStringOrNull(sequence.created_at) ?? '',
    updated_at: toStringOrNull(sequence.updated_at),
    last_interaction: toStringOrNull(sequence.last_interaction),
    enqueued_at: toStringOrNull(sequence.enqueued_at),
    started_at: toStringOrNull(sequence.started_at),
    responded_at: toStringOrNull(sequence.responded_at),
    meeting_booked_at: toStringOrNull(sequence.meeting_booked_at),
    sender_id: toStringOrNull(sequence.sender_id),
    sender_name: toStringOrNull(sequence.sender_name),
    exclusion_info: exclusion
      ? {
          rule_name: toStringOrNull(exclusion.rule_name) ?? '',
          description: toStringOrNull(exclusion.description) ?? '',
          overridability: toStringOrNull(exclusion.overridability) ?? '',
        }
      : null,
  }
}

function mapMonacoSequenceTask(value: unknown): MonacoSequenceTask {
  const task = toRecord(value)
  return {
    id: toStringOrNull(task.id) ?? '',
    sequence_id: toStringOrNull(task.sequence_id) ?? '',
    order: toNumberOrNull(task.order) ?? 0,
    name: toStringOrNull(task.name),
    type: toStringOrNull(task.type) ?? '',
    status: toStringOrNull(task.status) ?? '',
    scheduled_at: toStringOrNull(task.scheduled_at) ?? '',
    completed_at: toStringOrNull(task.completed_at),
    task_body: toStringOrNull(task.task_body),
    subject: toStringOrNull(task.subject),
    outcome: toStringOrNull(task.outcome),
    hold_reason: toStringOrNull(task.hold_reason),
    hold_until: toStringOrNull(task.hold_until),
  }
}

/** Maps Monaco's documented `SequenceDetailResponse`: a sequence plus its ordered tasks. */
export function mapMonacoSequenceDetail(value: unknown): MonacoSequenceDetail {
  return {
    ...mapMonacoSequence(value),
    tasks: toArray(toRecord(value).tasks).map(mapMonacoSequenceTask),
  }
}

/** Maps Monaco's documented `AudienceResponse` fields. */
export function mapMonacoAudience(value: unknown): MonacoAudience {
  const audience = toRecord(value)
  return {
    id: toStringOrNull(audience.id) ?? '',
    name: toStringOrNull(audience.name) ?? '',
    type: toStringOrNull(audience.type) ?? '',
    status: toStringOrNull(audience.status) ?? '',
    contact_count: toNumberOrNull(audience.contact_count) ?? 0,
    created_at: toStringOrNull(audience.created_at) ?? '',
    updated_at: toStringOrNull(audience.updated_at) ?? '',
  }
}

/** Maps Monaco's documented `AudienceContactFailureGroup` list. */
export function mapMonacoAudienceContactFailures(value: unknown): MonacoAudienceContactFailure[] {
  return toArray(value).map((item) => {
    const failure = toRecord(item)
    return {
      reason: toStringOrNull(failure.reason) ?? '',
      contact_ids: toMonacoStringArray(failure.contact_ids),
    }
  })
}

/** Maps Monaco's documented `CampaignResponse` summary fields. */
export function mapMonacoCampaign(value: unknown): MonacoCampaign {
  const campaign = toRecord(value)
  return {
    id: toStringOrNull(campaign.id) ?? '',
    name: toStringOrNull(campaign.name) ?? '',
    status: toStringOrNull(campaign.status) ?? '',
    prioritized: campaign.prioritized === true,
    end_date: toStringOrNull(campaign.end_date),
    template_id: toStringOrNull(campaign.template_id) ?? '',
    template_name: toStringOrNull(campaign.template_name),
    audiences: toArray(campaign.audiences).map((item) => {
      const audience = toRecord(item)
      return {
        id: toStringOrNull(audience.id) ?? '',
        name: toStringOrNull(audience.name) ?? '',
      }
    }),
    enrollment_status: toStringOrNull(campaign.enrollment_status) ?? '',
    created_at: toStringOrNull(campaign.created_at) ?? '',
    updated_at: toStringOrNull(campaign.updated_at) ?? '',
  }
}

function mapMonacoCampaignDistribution(value: unknown): MonacoCampaignDistribution | null {
  if (!isRecordLike(value)) return null
  return {
    mode: toStringOrNull(value.mode) ?? '',
    sender_ids: toMonacoStringArray(value.sender_ids),
    percentages: Array.isArray(value.percentages)
      ? value.percentages.map((item) => {
          const share = toRecord(item)
          return {
            sender_id: toStringOrNull(share.sender_id) ?? '',
            percentage: toNumberOrNull(share.percentage) ?? 0,
          }
        })
      : null,
    fallback_sender_id: toStringOrNull(value.fallback_sender_id),
  }
}

function mapMonacoToggleRule(value: unknown): MonacoToggleRule | null {
  if (!isRecordLike(value)) return null
  return { enabled: value.enabled === true }
}

function mapMonacoCooldownRule(value: unknown): MonacoCooldownRule | null {
  if (!isRecordLike(value)) return null
  return { enabled: value.enabled === true, days: toNumberOrNull(value.days) }
}

function mapMonacoStopAndDismissRule(value: unknown): MonacoStopAndDismissRule | null {
  if (!isRecordLike(value)) return null
  return {
    enabled: value.enabled === true,
    statuses: Array.isArray(value.statuses) ? toMonacoStringArray(value.statuses) : null,
  }
}

function mapMonacoRulesOfEngagement(value: unknown): MonacoRulesOfEngagement | null {
  if (!isRecordLike(value)) return null
  const maxContacts = isRecordLike(value.max_contacts_in_sequence)
    ? value.max_contacts_in_sequence
    : null
  return {
    do_not_contact: mapMonacoToggleRule(value.do_not_contact),
    allow_sequence_stop_on_meeting_booked: mapMonacoToggleRule(
      value.allow_sequence_stop_on_meeting_booked
    ),
    contact_cooldown: mapMonacoCooldownRule(value.contact_cooldown),
    account_cooldown: mapMonacoCooldownRule(value.account_cooldown),
    max_contacts_in_sequence: maxContacts
      ? {
          enabled: maxContacts.enabled === true,
          max_contacts: toNumberOrNull(maxContacts.max_contacts),
        }
      : null,
    allow_non_account_owner_campaigns: mapMonacoToggleRule(value.allow_non_account_owner_campaigns),
    allow_stop_and_dismiss_on_account_status: mapMonacoStopAndDismissRule(
      value.allow_stop_and_dismiss_on_account_status
    ),
    exclude_sequences_on_account_status: mapMonacoStopAndDismissRule(
      value.exclude_sequences_on_account_status
    ),
  }
}

/** Maps Monaco's documented `CampaignDetailResponse`: the full campaign resource. */
export function mapMonacoCampaignDetail(value: unknown): MonacoCampaignDetail {
  const campaign = toRecord(value)
  const autopilot = toRecord(campaign.autopilot_settings)
  const readiness = toRecord(campaign.contact_readiness_settings)
  const email = isRecordLike(readiness.email) ? readiness.email : null
  return {
    ...mapMonacoCampaign(campaign),
    distribution: mapMonacoCampaignDistribution(campaign.distribution),
    rules_of_engagement: mapMonacoRulesOfEngagement(campaign.rules_of_engagement),
    autopilot_mode: toStringOrNull(campaign.autopilot_mode) ?? '',
    autopilot_settings: {
      sender_rates: toArray(autopilot.sender_rates).map((item) => {
        const rate = toRecord(item)
        return {
          sender_id: toStringOrNull(rate.sender_id) ?? '',
          daily_rate_target: toNumberOrNull(rate.daily_rate_target) ?? 0,
        }
      }),
    },
    contact_readiness_settings: {
      email: email
        ? {
            check_on_enroll: email.check_on_enroll === true,
            on_failure: toStringOrNull(email.on_failure),
          }
        : null,
    },
  }
}

/** Maps Monaco's documented `EnrollFailureReason` list. */
export function mapMonacoEnrollFailureReasons(value: unknown): MonacoEnrollFailureReason[] {
  return toArray(value).map((item) => {
    const reason = toRecord(item)
    return {
      code: toStringOrNull(reason.code) ?? '',
      description: toStringOrNull(reason.description) ?? '',
      count: toNumberOrNull(reason.count) ?? 0,
    }
  })
}
