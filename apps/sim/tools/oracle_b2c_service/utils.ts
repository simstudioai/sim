import { filterUndefined } from '@sim/utils/object'
import {
  DEFAULT_APPLICATION_CONTEXT,
  DEFAULT_PAGE_LIMIT,
  INCIDENT_RESPONSE_CHANNEL_ID,
  INCIDENT_RESPONSE_ENTRY_TYPE_ID,
  MAX_APPLICATION_CONTEXT_LENGTH,
  MAX_PAGE_LIMIT,
  ORACLE_B2C_SERVICE_API_PATH,
  ORACLE_B2C_SERVICE_LIST_FIELDS,
  type OracleB2CServiceCollection,
} from '@/tools/oracle_b2c_service/constants'
import type {
  OracleAnswer,
  OracleAnswerSummary,
  OracleAnswerWriteFields,
  OracleAssignedTo,
  OracleB2CServiceAuthParams,
  OracleB2CServiceListParams,
  OracleContact,
  OracleContactSummary,
  OracleContactWriteFields,
  OracleCustomFields,
  OracleIncident,
  OracleIncidentResponseResponse,
  OracleIncidentSummary,
  OracleIncidentThread,
  OracleIncidentWriteFields,
  OracleMutationResponse,
  OracleName,
  OracleNamedId,
  OracleOrganization,
  OracleOrganizationSummary,
  OracleOrganizationWriteFields,
  OraclePageResponse,
  OracleReferenceLink,
  OracleResourceReference,
  OracleResourceResponse,
  OracleStatusWithType,
} from '@/tools/oracle_b2c_service/types'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readObject(value: unknown): JsonObject | null {
  return isObject(value) ? value : null
}

function readString(record: JsonObject | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

function readBoolean(record: JsonObject | null, key: string): boolean | null {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : null
}

function readFiniteNumber(record: JsonObject | null, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Oracle documents resource IDs as 64-bit numbers, which can exceed JavaScript's
 * exact integer range. String IDs remain exact. A numeric response is accepted
 * only when it is demonstrably safe; otherwise returning it would corrupt the ID.
 */
export function readOracleId(value: unknown, label = 'Oracle ID'): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value)
  }
  if (typeof value === 'number') {
    throw new Error(
      `${label} exceeds JavaScript's safe integer range; Oracle must return it as a string.`
    )
  }
  return null
}

export function requireOracleId(value: unknown, label: string): string {
  const id = typeof value === 'number' ? readOracleId(value, label) : String(value ?? '').trim()
  if (!id || !/^[1-9]\d*$/.test(id)) {
    throw new Error(`${label} must be a positive Oracle numeric ID represented as a string.`)
  }
  return id
}

/** Convert a nested JSON reference ID without risking numeric precision loss. */
export function toSafeOracleNumberId(value: unknown, label: string): number {
  const id = String(value ?? '').trim()
  if (!/^\d+$/.test(id)) {
    throw new Error(`${label} must be a non-negative Oracle numeric ID represented as a string.`)
  }
  const numericId = Number(id)
  if (!Number.isSafeInteger(numericId)) {
    throw new Error(
      `${label} exceeds JavaScript's safe integer range and cannot be sent safely in a JSON body.`
    )
  }
  return numericId
}

export function normalizeSiteUrl(siteUrl: unknown): string {
  const raw = typeof siteUrl === 'string' ? siteUrl.trim() : ''
  if (!raw) throw new Error('Oracle B2C Service site URL is required.')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Oracle B2C Service site URL must be a valid HTTPS origin.')
  }

  if (url.protocol !== 'https:') {
    throw new Error('Oracle B2C Service site URL must use HTTPS.')
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  ) {
    throw new Error(
      'Oracle B2C Service site URL must be an origin only, without credentials, path, query, or fragment.'
    )
  }

  return url.origin
}

function requireCredential(
  value: unknown,
  label: string,
  options: { trim?: boolean } = {}
): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`)
  return options.trim ? value.trim() : value
}

export function buildOracleHeaders(
  params: OracleB2CServiceAuthParams,
  options: { json?: boolean } = {}
): Record<string, string> {
  const username = requireCredential(params.username, 'Oracle B2C Service username', { trim: true })
  const password = requireCredential(params.password, 'Oracle B2C Service password')
  const applicationContext = (params.applicationContext ?? DEFAULT_APPLICATION_CONTEXT).trim()

  if (!applicationContext) {
    throw new Error('Oracle B2C Service application context cannot be blank.')
  }
  if (applicationContext.length > MAX_APPLICATION_CONTEXT_LENGTH) {
    throw new Error(
      `Oracle B2C Service application context must be at most ${MAX_APPLICATION_CONTEXT_LENGTH} characters.`
    )
  }

  return {
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    'OSvC-CREST-Application-Context': applicationContext,
    ...(options.json ? { 'Content-Type': 'application/json' } : {}),
  }
}

export function buildCollectionUrl(
  params: OracleB2CServiceListParams,
  collection: OracleB2CServiceCollection
): string {
  const origin = normalizeSiteUrl(params.siteUrl)
  const collectionPath = `${ORACLE_B2C_SERVICE_API_PATH}/${collection}`
  const fields = ORACLE_B2C_SERVICE_LIST_FIELDS[collection]
  const pageUrl = typeof params.pageUrl === 'string' ? params.pageUrl.trim() : ''

  if (pageUrl) {
    const hasOtherControls =
      Boolean(params.q?.trim()) ||
      Boolean(params.orderBy?.trim()) ||
      params.limit !== undefined ||
      params.offset !== undefined ||
      params.includeTotalResults !== undefined
    if (hasOtherControls) {
      throw new Error(
        'pageUrl is mutually exclusive with q, orderBy, limit, offset, and includeTotalResults.'
      )
    }

    let parsedPageUrl: URL
    try {
      parsedPageUrl = new URL(pageUrl)
    } catch {
      throw new Error('pageUrl must be a valid absolute HTTPS URL returned by Oracle.')
    }
    if (
      parsedPageUrl.protocol !== 'https:' ||
      parsedPageUrl.origin !== origin ||
      parsedPageUrl.pathname.replace(/\/$/, '') !== collectionPath ||
      parsedPageUrl.username ||
      parsedPageUrl.password ||
      parsedPageUrl.hash
    ) {
      throw new Error(`pageUrl must target the same Oracle site and ${collectionPath} collection.`)
    }

    const allowedKeys = new Set(['fields', 'limit', 'offset', 'orderBy', 'q', 'totalResults'])
    for (const key of parsedPageUrl.searchParams.keys()) {
      if (!allowedKeys.has(key)) {
        throw new Error(`pageUrl contains unsupported query parameter: ${key}.`)
      }
      if (parsedPageUrl.searchParams.getAll(key).length > 1) {
        throw new Error(`pageUrl query parameter ${key} must appear only once.`)
      }
    }

    const pageLimit = parsedPageUrl.searchParams.get('limit')
    if (pageLimit !== null) {
      const numericLimit = Number(pageLimit)
      if (!Number.isInteger(numericLimit) || numericLimit < 1 || numericLimit > MAX_PAGE_LIMIT) {
        throw new Error(`pageUrl limit must be an integer from 1 to ${MAX_PAGE_LIMIT}.`)
      }
    }
    const pageOffset = parsedPageUrl.searchParams.get('offset')
    if (pageOffset !== null) {
      const numericOffset = Number(pageOffset)
      if (!Number.isInteger(numericOffset) || numericOffset < 0) {
        throw new Error('pageUrl offset must be a non-negative integer.')
      }
    }
    const pageTotalResults = parsedPageUrl.searchParams.get('totalResults')
    if (pageTotalResults !== null && pageTotalResults !== 'true' && pageTotalResults !== 'false') {
      throw new Error('pageUrl totalResults must be true or false.')
    }
    const pageFields = parsedPageUrl.searchParams.get('fields')
    if (pageFields !== null && pageFields !== fields) {
      throw new Error(`pageUrl fields must match the fixed ${collection} list projection.`)
    }
    parsedPageUrl.searchParams.set('fields', fields)
    return parsedPageUrl.toString()
  }

  const limit = params.limit === undefined ? DEFAULT_PAGE_LIMIT : Number(params.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_PAGE_LIMIT}.`)
  }
  const offset = params.offset === undefined ? undefined : Number(params.offset)
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new Error('offset must be a non-negative integer.')
  }

  const query = new URLSearchParams({ fields, limit: String(limit) })
  if (params.q?.trim()) query.set('q', params.q.trim())
  if (params.orderBy?.trim()) query.set('orderBy', params.orderBy.trim())
  if (offset !== undefined) query.set('offset', String(offset))
  if (params.includeTotalResults !== undefined) {
    const includeTotalResults =
      params.includeTotalResults === true || String(params.includeTotalResults) === 'true'
    query.set('totalResults', String(includeTotalResults))
  }

  return `${origin}${collectionPath}?${query.toString()}`
}

export function buildResourceUrl(
  params: OracleB2CServiceAuthParams,
  collection: OracleB2CServiceCollection,
  id: unknown,
  expand?: readonly string[]
): string {
  const origin = normalizeSiteUrl(params.siteUrl)
  const resourceId = requireOracleId(id, `${collection} ID`)
  const url = new URL(`${origin}${ORACLE_B2C_SERVICE_API_PATH}/${collection}/${resourceId}`)
  if (expand?.length) url.searchParams.set('expand', expand.join(','))
  return url.toString()
}

export function buildCreateUrl(
  params: OracleB2CServiceAuthParams,
  collection: OracleB2CServiceCollection
): string {
  return `${normalizeSiteUrl(params.siteUrl)}${ORACLE_B2C_SERVICE_API_PATH}/${collection}`
}

export function buildIncidentResponseUrl(params: OracleB2CServiceAuthParams): string {
  return `${normalizeSiteUrl(params.siteUrl)}${ORACLE_B2C_SERVICE_API_PATH}/incidentResponse`
}

function getOracleErrorMessage(data: unknown, response: Response): string {
  const object = readObject(data)
  const detail = readString(object, 'detail')
  const title = readString(object, 'title')
  const errorCode = readString(object, 'o:errorCode')
  const summary = detail || title || `Oracle B2C Service request failed (HTTP ${response.status})`
  return errorCode ? `${summary} (${errorCode})` : summary
}

export async function parseOracleResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      if (!response.ok) {
        throw new Error(`Oracle B2C Service request failed (HTTP ${response.status}).`)
      }
      throw new Error('Oracle B2C Service returned an invalid JSON response.')
    }
  }

  if (!response.ok) throw new Error(getOracleErrorMessage(data, response))
  return data
}

function mapNamedId(value: unknown, label: string): OracleNamedId | null {
  const record = readObject(value)
  if (!record) return null
  return {
    id: readOracleId(record.id, `${label} ID`),
    lookupName: readString(record, 'lookupName'),
  }
}

function mapReferenceLink(value: unknown): OracleReferenceLink | null {
  const record = readObject(value)
  if (!record) return null
  return { rel: readString(record, 'rel'), href: readString(record, 'href') }
}

function mapResourceReference(value: unknown): OracleResourceReference | null {
  const record = readObject(value)
  if (!record) return null
  const links = Array.isArray(record.links)
    ? record.links
        .map(mapReferenceLink)
        .filter((link): link is OracleReferenceLink => link !== null)
    : []
  return { links }
}

function mapStatusWithType(value: unknown, label: string): OracleStatusWithType | null {
  const record = readObject(value)
  if (!record) return null
  return {
    status: mapNamedId(record.status, `${label} status`),
    statusType: mapNamedId(record.statusType, `${label} status type`),
  }
}

function mapAssignedTo(value: unknown): OracleAssignedTo | null {
  const record = readObject(value)
  if (!record) return null
  return {
    account: mapResourceReference(record.account),
    staffGroup: mapNamedId(record.staffGroup, 'Assigned staff group'),
  }
}

function mapCustomFields(value: unknown): OracleCustomFields | null {
  return isObject(value) ? value : null
}

function mapName(value: unknown): OracleName | null {
  const record = readObject(value)
  if (!record) return null
  return { first: readString(record, 'first'), last: readString(record, 'last') }
}

function mapIncidentThread(value: unknown): OracleIncidentThread | null {
  const record = readObject(value)
  if (!record) return null
  return {
    id: readOracleId(record.id, 'Incident thread ID'),
    text: readString(record, 'text'),
    createdTime: readString(record, 'createdTime'),
    channel: mapNamedId(record.channel, 'Incident thread channel'),
    entryType: mapNamedId(record.entryType, 'Incident thread entry type'),
  }
}

function readExpandedItems(value: unknown): unknown[] {
  const collection = readObject(value)
  return Array.isArray(collection?.items) ? collection.items : []
}

function mapIncidentSummaryRecord(record: JsonObject): OracleIncidentSummary {
  return {
    id: readOracleId(record.id, 'Incident ID'),
    lookupName: readString(record, 'lookupName'),
    createdTime: readString(record, 'createdTime'),
    updatedTime: readString(record, 'updatedTime'),
    subject: readString(record, 'subject'),
    primaryContact: mapResourceReference(record.primaryContact),
    organization: mapResourceReference(record.organization),
    queue: mapNamedId(record.queue, 'Queue'),
    severity: mapNamedId(record.severity, 'Severity'),
    category: mapResourceReference(record.category),
    product: mapResourceReference(record.product),
    statusWithType: mapStatusWithType(record.statusWithType, 'Incident'),
    assignedTo: mapAssignedTo(record.assignedTo),
  }
}

export function mapIncidentSummary(value: unknown): OracleIncidentSummary {
  return mapIncidentSummaryRecord(readObject(value) ?? {})
}

export function mapIncident(value: unknown): OracleIncident {
  const record = readObject(value) ?? {}
  const threads = readExpandedItems(record.threads)
    .map(mapIncidentThread)
    .filter((item): item is OracleIncidentThread => item !== null)
  return {
    ...mapIncidentSummaryRecord(record),
    threads,
    customFields: mapCustomFields(record.customFields),
  }
}

function mapContactSummaryRecord(record: JsonObject): OracleContactSummary {
  return {
    id: readOracleId(record.id, 'Contact ID'),
    lookupName: readString(record, 'lookupName'),
    createdTime: readString(record, 'createdTime'),
    updatedTime: readString(record, 'updatedTime'),
    name: mapName(record.name),
    title: readString(record, 'title'),
    disabled: readBoolean(record, 'disabled'),
    externalReference: readString(record, 'externalReference'),
    organization: mapResourceReference(record.organization),
  }
}

export function mapContactSummary(value: unknown): OracleContactSummary {
  return mapContactSummaryRecord(readObject(value) ?? {})
}

export function mapContact(value: unknown): OracleContact {
  const record = readObject(value) ?? {}
  const emails = readExpandedItems(record.emails).flatMap((value) => {
    const email = readObject(value)
    return email
      ? [
          {
            address: readString(email, 'address'),
            addressType: mapNamedId(email.addressType, 'Email address type'),
          },
        ]
      : []
  })
  const phones = readExpandedItems(record.phones).flatMap((value) => {
    const phone = readObject(value)
    return phone
      ? [
          {
            number: readString(phone, 'number'),
            rawNumber: readString(phone, 'rawNumber'),
            phoneType: mapNamedId(phone.phoneType, 'Phone number type'),
          },
        ]
      : []
  })
  return {
    ...mapContactSummaryRecord(record),
    emails,
    phones,
    customFields: mapCustomFields(record.customFields),
  }
}

function mapOrganizationSummaryRecord(record: JsonObject): OracleOrganizationSummary {
  return {
    id: readOracleId(record.id, 'Organization ID'),
    lookupName: readString(record, 'lookupName'),
    createdTime: readString(record, 'createdTime'),
    updatedTime: readString(record, 'updatedTime'),
    name: readString(record, 'name'),
    externalReference: readString(record, 'externalReference'),
    parent: mapResourceReference(record.parent),
    industry: mapNamedId(record.industry, 'Industry'),
    numberOfEmployees: readFiniteNumber(record, 'numberOfEmployees'),
  }
}

export function mapOrganizationSummary(value: unknown): OracleOrganizationSummary {
  return mapOrganizationSummaryRecord(readObject(value) ?? {})
}

export function mapOrganization(value: unknown): OracleOrganization {
  const record = readObject(value) ?? {}
  return {
    ...mapOrganizationSummaryRecord(record),
    customFields: mapCustomFields(record.customFields),
  }
}

function mapAnswerSummaryRecord(record: JsonObject): OracleAnswerSummary {
  return {
    id: readOracleId(record.id, 'Answer ID'),
    lookupName: readString(record, 'lookupName'),
    createdTime: readString(record, 'createdTime'),
    updatedTime: readString(record, 'updatedTime'),
    answerType: mapNamedId(record.answerType, 'Answer type'),
    language: mapNamedId(record.language, 'Language'),
    summary: readString(record, 'summary'),
    keywords: readString(record, 'keywords'),
    statusWithType: mapStatusWithType(record.statusWithType, 'Answer'),
    publishOnDate: readString(record, 'publishOnDate'),
    expiresDate: readString(record, 'expiresDate'),
  }
}

export function mapAnswerSummary(value: unknown): OracleAnswerSummary {
  return mapAnswerSummaryRecord(readObject(value) ?? {})
}

export function mapAnswer(value: unknown): OracleAnswer {
  const record = readObject(value) ?? {}
  return {
    ...mapAnswerSummaryRecord(record),
    question: readString(record, 'question'),
    solution: readString(record, 'solution'),
    customFields: mapCustomFields(record.customFields),
  }
}

function resolvePageLink(
  links: unknown,
  rel: 'next' | 'prev',
  params?: OracleB2CServiceAuthParams
): string | null {
  if (!Array.isArray(links)) return null
  const match = links.find((value) => {
    const link = readObject(value)
    return link?.rel === rel && typeof link.href === 'string'
  })
  const href = readString(readObject(match), 'href')
  if (!href) return null
  try {
    return params
      ? new URL(href, normalizeSiteUrl(params.siteUrl)).toString()
      : new URL(href).toString()
  } catch {
    return null
  }
}

export function transformPageResponse<T>(mapper: (value: unknown) => T) {
  return async (
    response: Response,
    params?: OracleB2CServiceAuthParams
  ): Promise<OraclePageResponse<T>> => {
    const data = readObject(await parseOracleResponse(response)) ?? {}
    const items = Array.isArray(data.items) ? data.items.map(mapper) : []
    return {
      success: true,
      output: {
        items,
        count: items.length,
        hasMore: data.hasMore === true,
        totalResults:
          typeof data.totalResults === 'number' && Number.isFinite(data.totalResults)
            ? data.totalResults
            : null,
        nextPageUrl: resolvePageLink(data.links, 'next', params),
        previousPageUrl: resolvePageLink(data.links, 'prev', params),
      },
    }
  }
}

export function transformResourceResponse<T>(mapper: (value: unknown) => T) {
  return async (response: Response): Promise<OracleResourceResponse<T>> => ({
    success: true,
    output: { resource: mapper(await parseOracleResponse(response)) },
  })
}

export function transformMutationResponse(kind: 'updated' | 'deleted') {
  return async (response: Response, params?: { id?: string }): Promise<OracleMutationResponse> => {
    if (!response.ok) await parseOracleResponse(response)
    const id = requireOracleId(params?.id, 'Oracle resource ID')
    return { success: true, output: { id, [kind]: true } }
  }
}

export async function transformIncidentResponse(
  response: Response
): Promise<OracleIncidentResponseResponse> {
  const data = readObject(await parseOracleResponse(response))
  return {
    success: true,
    output: {
      incident: mapNamedId(data?.incident, 'Incident'),
      responseSent: true,
    },
  }
}

function validateCustomFields(value: unknown): OracleCustomFields | undefined {
  if (value === undefined) return undefined
  if (!isObject(value)) throw new Error('customFields must be a JSON object.')
  return value
}

function optionalReference(value: unknown, label: string): { id: number } | undefined {
  return value === undefined || value === null || value === ''
    ? undefined
    : { id: toSafeOracleNumberId(value, label) }
}

function validateExternalReference(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)) {
    throw new Error('externalReference must contain 1-20 digits and cannot start with zero.')
  }
  return value
}

function validateNumberOfEmployees(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const count = Number(value)
  if (!Number.isInteger(count) || count < 0 || count > 2147483647) {
    throw new Error('numberOfEmployees must be an integer from 0 to 2147483647.')
  }
  return count
}

export function buildIncidentBody(params: OracleIncidentWriteFields): JsonObject {
  const assignedTo = filterUndefined({
    account: optionalReference(params.assignedAccountId, 'Assigned account ID'),
    staffGroup: optionalReference(params.assignedStaffGroupId, 'Assigned staff group ID'),
  })
  return filterUndefined({
    subject: params.subject,
    primaryContact: optionalReference(params.primaryContactId, 'Primary contact ID'),
    organization: optionalReference(params.organizationId, 'Organization ID'),
    queue: optionalReference(params.queueId, 'Queue ID'),
    severity: optionalReference(params.severityId, 'Severity ID'),
    category: optionalReference(params.categoryId, 'Category ID'),
    product: optionalReference(params.productId, 'Product ID'),
    statusWithType:
      params.statusId === undefined || params.statusId === null || params.statusId === ''
        ? undefined
        : { status: { id: toSafeOracleNumberId(params.statusId, 'Status ID') } },
    assignedTo: Object.keys(assignedTo).length ? assignedTo : undefined,
    customFields: validateCustomFields(params.customFields),
  })
}

export function buildContactBody(params: OracleContactWriteFields): JsonObject {
  const name = filterUndefined({ first: params.firstName, last: params.lastName })
  const emails = params.emails?.map((email, index) => {
    if (!email || typeof email.address !== 'string' || !email.address.trim()) {
      throw new Error(`emails[${index}].address is required.`)
    }
    return {
      address: email.address.trim(),
      addressType: {
        id: toSafeOracleNumberId(email.addressTypeId, `emails[${index}].addressTypeId`),
      },
    }
  })
  return filterUndefined({
    name: Object.keys(name).length ? name : undefined,
    title: params.title,
    organization: optionalReference(params.organizationId, 'Organization ID'),
    externalReference: validateExternalReference(params.externalReference),
    disabled: params.disabled,
    emails,
    customFields: validateCustomFields(params.customFields),
  })
}

export function buildOrganizationBody(params: OracleOrganizationWriteFields): JsonObject {
  return filterUndefined({
    name: params.name,
    externalReference: validateExternalReference(params.externalReference),
    parent: optionalReference(params.parentOrganizationId, 'Parent organization ID'),
    industry: optionalReference(params.industryId, 'Industry ID'),
    numberOfEmployees: validateNumberOfEmployees(params.numberOfEmployees),
    customFields: validateCustomFields(params.customFields),
  })
}

export function buildAnswerBody(params: OracleAnswerWriteFields): JsonObject {
  return filterUndefined({
    answerType: optionalReference(params.answerTypeId, 'Answer type ID'),
    language: optionalReference(params.languageId, 'Language ID'),
    summary: params.summary,
    question: params.question,
    solution: params.solution,
    keywords: params.keywords,
    statusWithType:
      params.statusId === undefined || params.statusId === null || params.statusId === ''
        ? undefined
        : { status: { id: toSafeOracleNumberId(params.statusId, 'Status ID') } },
    publishOnDate: params.publishOnDate,
    expiresDate: params.expiresDate,
    customFields: validateCustomFields(params.customFields),
  })
}

export function buildIncidentResponseBody(params: {
  incidentId: string
  text: string
  subject?: string
  ccEmails?: string[]
  bccEmails?: string[]
  useEmailSignature?: boolean
}): JsonObject {
  const text = typeof params.text === 'string' ? params.text.trim() : ''
  if (!text) throw new Error('Incident response text is required.')

  const emailGroup = (emails: string[] | undefined, label: string) => {
    if (emails === undefined) return undefined
    if (!Array.isArray(emails)) throw new Error(`${label} must be an array of email addresses.`)
    return { emailAddresses: emails.map((email) => String(email).trim()).filter(Boolean) }
  }

  return filterUndefined({
    incident: filterUndefined({
      id: toSafeOracleNumberId(params.incidentId, 'Incident ID'),
      subject: params.subject,
      threads: [
        {
          text,
          channel: { id: INCIDENT_RESPONSE_CHANNEL_ID },
          entryType: { id: INCIDENT_RESPONSE_ENTRY_TYPE_ID },
        },
      ],
    }),
    cc: emailGroup(params.ccEmails, 'ccEmails'),
    bcc: emailGroup(params.bccEmails, 'bccEmails'),
    useEmailSignature: params.useEmailSignature,
  })
}

export function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`)
  return value.trim()
}

export function requireAtLeastOneField(body: JsonObject, label: string): JsonObject {
  if (!Object.keys(body).length) throw new Error(`${label} requires at least one field to update.`)
  return body
}
