import { toBooleanOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type {
  CheckrAdverseAction,
  CheckrAdverseItem,
  CheckrCandidate,
  CheckrCandidateFieldParams,
  CheckrContinuousCheck,
  CheckrDocument,
  CheckrGeo,
  CheckrInvitation,
  CheckrNode,
  CheckrPackage,
  CheckrProgram,
  CheckrReport,
  CheckrSubscription,
  CheckrVerification,
  CheckrWorkLocation,
} from '@/tools/checkr/types'
import type { ParameterVisibility } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const CHECKR_API_BASE_URL = 'https://api.checkr.com/v1'

/** Checkr reports failures as `{ "error": "<message>" }`. */
export const CHECKR_ERROR_EXTRACTOR = 'nested-error-object'

export const CHECKR_API_KEY_PARAM = {
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Checkr production secret API key',
  },
} as const

export const CHECKR_PAGINATION_PARAMS = {
  page: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Page number to retrieve (starts at 1)',
  },
  perPage: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Number of records per page, from 0 to 100 (default 25)',
  },
}

/**
 * Checkr authenticates with HTTP Basic auth: the secret API key is the username
 * and the password is empty.
 */
export function checkrHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Basic ${btoa(`${apiKey.trim()}:`)}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

type QueryValue = string | number | boolean | null | undefined

/**
 * Builds a Checkr API URL from already-encoded path segments and an optional
 * query. Empty query values are dropped so optional filters stay off the wire.
 */
export function checkrUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${CHECKR_API_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) url.searchParams.set(key, text)
  }
  return url.toString()
}

/** Encodes a resource ID for a Checkr path, rejecting traversal and separators. */
export function checkrId(value: string | undefined, paramName: string): string {
  return safeUrlPathSegment(value ?? '', paramName)
}

function optionalInteger(
  value: unknown,
  paramName: string,
  min: number,
  max?: number
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    throw new Error(
      max === undefined
        ? `Invalid ${paramName}: expected an integer of at least ${min}.`
        : `Invalid ${paramName}: expected an integer from ${min} to ${max}.`
    )
  }
  return parsed
}

/** Validates Checkr's documented pagination bounds (`page` ≥ 1, `per_page` 0–100). */
export function checkrPaginationQuery(params: {
  page?: number
  perPage?: number
}): Record<string, number | undefined> {
  return {
    page: optionalInteger(params.page, 'page', 1),
    per_page: optionalInteger(params.perPage, 'perPage', 0, 100),
  }
}

/** Validates a positive integer input such as a subscription interval count. */
export function checkrPositiveInteger(value: unknown, paramName: string): number | undefined {
  return optionalInteger(value, paramName, 1)
}

/** Trims a string input and returns undefined when it is empty. */
export function trimmed(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

/**
 * Accepts a JSON value supplied either as structured data (agent calls) or as a
 * JSON string (block inputs). Empty input returns undefined.
 */
function parseCheckrJson(value: unknown, label: string): unknown {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Invalid ${label}: expected valid JSON.`)
  }
}

/** Parses an optional JSON object input such as candidate metadata. */
export function parseCheckrObject(
  value: unknown,
  label: string
): Record<string, unknown> | undefined {
  const parsed = parseCheckrJson(value, label)
  if (parsed === undefined) return undefined
  if (!isRecordLike(parsed)) {
    throw new Error(`Invalid ${label}: expected a JSON object.`)
  }
  return parsed
}

/** Parses an optional JSON array input such as work locations. */
export function parseCheckrArray(value: unknown, label: string): unknown[] | undefined {
  const parsed = parseCheckrJson(value, label)
  if (parsed === undefined) return undefined
  if (!Array.isArray(parsed)) throw new Error(`Invalid ${label}: expected a JSON array.`)
  return parsed
}

/**
 * Parses a list of strings given as an array, a JSON array string, or a
 * comma-separated string (tags, geo IDs, adverse item IDs).
 */
export function parseCheckrStringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return undefined
  if (text.startsWith('[')) {
    const parsed = parseCheckrArray(text, 'list')
    return (parsed ?? []).map((item) => String(item).trim()).filter(Boolean)
  }
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** Adds the `node` and `work_locations` fields Checkr requires for hierarchy-enabled accounts. */
export function applyHierarchyFields(
  body: Record<string, unknown>,
  params: { node?: string; workLocations?: unknown }
): void {
  const node = trimmed(params.node)
  if (node) body.node = node
  const workLocations = parseCheckrArray(params.workLocations, 'workLocations')
  if (workLocations) body.work_locations = workLocations
}

export const CHECKR_HIERARCHY_PARAMS = {
  node: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description:
      'custom_id of the account hierarchy node (required for hierarchy-enabled accounts)',
  },
  workLocations: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description:
      'Work locations as a JSON array of { country, state, city } objects, e.g. [{"country":"US","state":"CA","city":"San Francisco"}]. state is required; country defaults to US',
  },
}

type Raw = Record<string, unknown>

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function strings(value: unknown): string[] {
  return toArray(value).filter((item): item is string => typeof item === 'string')
}

/** Reads the first string array present across Checkr's alternate field spellings. */
function stringsFrom(raw: Raw, ...keys: string[]): string[] {
  for (const key of keys) {
    if (Array.isArray(raw[key])) return strings(raw[key])
  }
  return []
}

function mapWorkLocations(value: unknown): CheckrWorkLocation[] {
  return toArray(value).map((item) => {
    const location = toRecord(item)
    return {
      country: toStringOrNull(location.country),
      state: toStringOrNull(location.state),
      city: toStringOrNull(location.city),
    }
  })
}

export function mapCandidate(value: unknown): CheckrCandidate {
  const c = toRecord(value)
  return {
    id: toStringOrNull(c.id) ?? '',
    uri: toStringOrNull(c.uri),
    createdAt: toStringOrNull(c.created_at),
    firstName: toStringOrNull(c.first_name),
    middleName: toStringOrNull(c.middle_name),
    noMiddleName: toBooleanOrNull(c.no_middle_name),
    lastName: toStringOrNull(c.last_name),
    motherMaidenName: toStringOrNull(c.mother_maiden_name),
    email: toStringOrNull(c.email),
    phone: toStringOrNull(c.phone),
    zipcode: toStringOrNull(c.zipcode),
    dob: toStringOrNull(c.dob),
    ssn: toStringOrNull(c.ssn),
    driverLicenseNumber: toStringOrNull(c.driver_license_number),
    driverLicenseState: toStringOrNull(c.driver_license_state),
    previousDriverLicenseNumber: toStringOrNull(c.previous_driver_license_number),
    previousDriverLicenseState: toStringOrNull(c.previous_driver_license_state),
    copyRequested: toBooleanOrNull(c.copy_requested),
    customId: toStringOrNull(c.custom_id),
    adjudication: toStringOrNull(c.adjudication),
    reportIds: strings(c.report_ids),
    geoIds: strings(c.geo_ids),
    postalAddress: toRecordOrNull(c.postal_address),
    metadata: toRecordOrNull(c.metadata),
  }
}

export function mapInvitation(value: unknown): CheckrInvitation {
  const i = toRecord(value)
  return {
    id: toStringOrNull(i.id) ?? '',
    uri: toStringOrNull(i.uri),
    invitationUrl: toStringOrNull(i.invitation_url),
    status: toStringOrNull(i.status),
    createdAt: toStringOrNull(i.created_at),
    expiresAt: toStringOrNull(i.expires_at),
    completedAt: toStringOrNull(i.completed_at),
    deletedAt: toStringOrNull(i.deleted_at),
    package: toStringOrNull(i.package),
    candidateId: toStringOrNull(i.candidate_id),
    reportId: toStringOrNull(i.report_id),
    archived: toBooleanOrNull(i.archived),
    archivedInfo: toRecordOrNull(i.archived_info),
  }
}

export function mapReport(value: unknown): CheckrReport {
  const r = toRecord(value)
  return {
    id: toStringOrNull(r.id) ?? '',
    uri: toStringOrNull(r.uri),
    status: toStringOrNull(r.status),
    result: toStringOrNull(r.result),
    adjudication: toStringOrNull(r.adjudication),
    assessment: toStringOrNull(r.assessment),
    package: toStringOrNull(r.package),
    source: toStringOrNull(r.source),
    candidateId: toStringOrNull(r.candidate_id),
    includesCanceled: toBooleanOrNull(r.includes_canceled),
    createdAt: toStringOrNull(r.created_at),
    completedAt: toStringOrNull(r.completed_at),
    revisedAt: toStringOrNull(r.revised_at),
    upgradedAt: toStringOrNull(r.upgraded_at),
    turnaroundTime: num(r.turnaround_time),
    estimatedCompletionTime: toStringOrNull(r.estimated_completion_time),
    archived: toBooleanOrNull(r.archived),
    programId: toStringOrNull(r.program_id),
    segmentStamps: strings(r.segment_stamps),
    workLocations: mapWorkLocations(r.work_locations),
    geoIds: strings(r.geo_ids),
    documentIds: strings(r.document_ids),
    candidateStoryIds: strings(r.candidate_story_ids),
    ssnTraceId: toStringOrNull(r.ssn_trace_id),
    sexOffenderSearchId: toStringOrNull(r.sex_offender_search_id),
    nationalCriminalSearchId: toStringOrNull(r.national_criminal_search_id),
    globalWatchlistSearchId: toStringOrNull(r.global_watchlist_search_id),
    federalCriminalSearchId: toStringOrNull(r.federal_criminal_search_id),
    federalDistrictCriminalSearchId: toStringOrNull(r.federal_district_criminal_search_id),
    federalCivilSearchId: toStringOrNull(r.federal_civil_search_id),
    federalDistrictCivilSearchId: toStringOrNull(r.federal_district_civil_search_id),
    motorVehicleReportId: toStringOrNull(r.motor_vehicle_report_id),
    drugScreeningId: toStringOrNull(r.drug_screening_id),
    facisSearchId: toStringOrNull(r.facis_search_id),
    socialMediaScreeningsId: toStringOrNull(r.social_media_screenings_id),
    identityVerificationId: toStringOrNull(r.identity_verification_id),
    drugAlcoholClearinghouseId: toStringOrNull(r.drug_alcohol_clearinghouse_id),
    identityDataEvaluationId: toStringOrNull(r.identity_data_evaluation_id),
    occupationalHealthScreeningId: toStringOrNull(r.occupational_health_screening_id),
    arrestSearchId: toStringOrNull(r.arrest_search_id),
    internationalGlobalWatchlistSearchId: toStringOrNull(
      r.international_global_watchlist_search_id
    ),
    internationalEducationVerificationId: toStringOrNull(r.international_education_verification_id),
    internationalEmploymentVerificationId: toStringOrNull(
      r.international_employment_verification_id
    ),
    internationalIdentityDocumentValidationId: toStringOrNull(
      r.international_identity_document_validation_id
    ),
    internationalCriminalSearchIds: strings(r.international_criminal_searches_v2_ids),
    internationalAdverseMediaSearchIds: strings(r.international_adverse_media_search_ids),
    countyCriminalSearchIds: strings(r.county_criminal_search_ids),
    stateCriminalSearchIds: stringsFrom(r, 'state_criminal_search_ids', 'state_criminal_searches'),
    professionalLicenseVerificationIds: strings(r.professional_license_verification_ids),
    personalReferenceVerificationIds: strings(r.personal_reference_verification_ids),
    professionalReferenceVerificationIds: strings(r.professional_reference_verification_ids),
    drugScreening: toRecordOrNull(r.drug_screening),
  }
}

function mapAdverseItem(value: unknown): CheckrAdverseItem {
  const item = toRecord(value)
  return {
    id: toStringOrNull(item.id) ?? '',
    text: toStringOrNull(item.text),
    assessment: toRecordOrNull(item.assessment),
  }
}

export function mapAdverseItems(value: unknown): CheckrAdverseItem[] {
  return toArray(value).map(mapAdverseItem)
}

export function mapAdverseAction(value: unknown): CheckrAdverseAction {
  const a = toRecord(value)
  const delivery = toRecordOrNull(a.delivery)
  return {
    id: toStringOrNull(a.id) ?? '',
    uri: toStringOrNull(a.uri),
    status: toStringOrNull(a.status),
    reportId: toStringOrNull(a.report_id),
    createdAt: toStringOrNull(a.created_at),
    canceledAt: toStringOrNull(a.canceled_at),
    postNoticeScheduledAt: toStringOrNull(a.post_notice_scheduled_at),
    postNoticeReadyAt: toStringOrNull(a.post_notice_ready_at),
    individualizedAssessmentEngaged: toBooleanOrNull(a.individualized_assessment_engaged),
    context: toStringOrNull(a.context),
    delivery: delivery
      ? {
          state: toStringOrNull(delivery.state),
          reason: toStringOrNull(delivery.reason),
          updatedAt: toStringOrNull(delivery.updated_at),
        }
      : null,
    adverseItems: mapAdverseItems(a.adverse_items),
    events: toArray(a.events).map((event) => {
      const e = toRecord(event)
      return {
        id: toStringOrNull(e.id),
        type: toStringOrNull(e.type),
        time: toStringOrNull(e.time),
        trigger: toStringOrNull(e.trigger),
        user: toStringOrNull(e.user),
      }
    }),
  }
}

export function mapPackage(value: unknown): CheckrPackage {
  const p = toRecord(value)
  return {
    id: toStringOrNull(p.id) ?? '',
    uri: toStringOrNull(p.uri),
    name: toStringOrNull(p.name),
    slug: toStringOrNull(p.slug),
    price: num(p.price),
    applyUrl: toStringOrNull(p.apply_url),
    createdAt: toStringOrNull(p.created_at),
    deletedAt: toStringOrNull(p.deleted_at),
    screenings: toArray(p.screenings).map((screening) => {
      const s = toRecord(screening)
      return { type: toStringOrNull(s.type), subtype: toStringOrNull(s.subtype) }
    }),
  }
}

export function mapGeo(value: unknown): CheckrGeo {
  const g = toRecord(value)
  return {
    id: toStringOrNull(g.id) ?? '',
    uri: toStringOrNull(g.uri),
    name: toStringOrNull(g.name),
    city: toStringOrNull(g.city),
    state: toStringOrNull(g.state),
    createdAt: toStringOrNull(g.created_at),
    deletedAt: toStringOrNull(g.deleted_at),
  }
}

export function mapNode(value: unknown): CheckrNode {
  const n = toRecord(value)
  return {
    customId: toStringOrNull(n.custom_id) ?? '',
    name: toStringOrNull(n.name),
    tier: toStringOrNull(n.tier),
    parentCustomId: toStringOrNull(n.parent_custom_id),
    packages: strings(n.packages),
  }
}

export function mapProgram(value: unknown): CheckrProgram {
  const p = toRecord(value)
  return {
    id: toStringOrNull(p.id) ?? '',
    name: toStringOrNull(p.name),
    createdAt: toStringOrNull(p.created_at),
    deletedAt: toStringOrNull(p.deleted_at),
    packageIds: strings(p.package_ids),
    geoIds: strings(p.geo_ids),
  }
}

export function mapSubscription(value: unknown): CheckrSubscription {
  const s = toRecord(value)
  return {
    id: toStringOrNull(s.id) ?? '',
    uri: toStringOrNull(s.uri),
    status: toStringOrNull(s.status),
    package: toStringOrNull(s.package),
    candidateId: toStringOrNull(s.candidate_id),
    intervalCount: num(s.interval_count),
    intervalUnit: toStringOrNull(s.interval_unit),
    startDate: toStringOrNull(s.start_date),
    nextOccurrenceDate: toStringOrNull(s.next_occurrence_date),
    createdAt: toStringOrNull(s.created_at),
    canceledAt: toStringOrNull(s.canceled_at),
    node: toStringOrNull(s.node),
    workLocations: mapWorkLocations(s.work_locations),
  }
}

export function mapContinuousCheck(value: unknown): CheckrContinuousCheck {
  const c = toRecord(value)
  return {
    id: toStringOrNull(c.id) ?? '',
    type: toStringOrNull(c.type),
    candidateId: toStringOrNull(c.candidate_id),
    createdAt: toStringOrNull(c.created_at),
    node: toStringOrNull(c.node),
    workLocations: mapWorkLocations(c.work_locations),
  }
}

export function mapVerification(value: unknown): CheckrVerification {
  const v = toRecord(value)
  return {
    id: toStringOrNull(v.id) ?? '',
    uri: toStringOrNull(v.uri),
    verificationType: toStringOrNull(v.verification_type),
    verificationUrl: toStringOrNull(v.verification_url),
    reportId: toStringOrNull(v.report_id),
    createdAt: toStringOrNull(v.created_at),
    completedAt: toStringOrNull(v.completed_at),
    processedAt: toStringOrNull(v.processed_at),
  }
}

export function mapDocument(value: unknown): CheckrDocument {
  const d = toRecord(value)
  return {
    id: toStringOrNull(d.id) ?? '',
    type: toStringOrNull(d.type),
    filename: toStringOrNull(d.filename),
    contentType: toStringOrNull(d.content_type),
    filesize: num(d.filesize),
    downloadUri: toStringOrNull(d.download_uri),
    locale: toStringOrNull(d.locale),
    createdAt: toStringOrNull(d.created_at),
  }
}

/** Reads Checkr's list envelope (`count`, `next_href`, `previous_href`). */
export function mapListMeta(value: unknown): {
  count: number | null
  nextHref: string | null
  previousHref: string | null
} {
  const data = toRecord(value)
  return {
    count: num(data.count),
    nextHref: toStringOrNull(data.next_href),
    previousHref: toStringOrNull(data.previous_href),
  }
}

/** Maps Checkr's tag list envelope (`{ data: [{ name }], count }`). */
export function mapTags(value: unknown): { tags: string[]; count: number | null } {
  const data = toRecord(value)
  return {
    tags: toArray(data.data)
      .map((tag) => toStringOrNull(toRecord(tag).name))
      .filter((name): name is string => name !== null),
    count: num(data.count),
  }
}

const CANDIDATE_STRING_FIELDS = [
  ['firstName', 'first_name'],
  ['middleName', 'middle_name'],
  ['lastName', 'last_name'],
  ['motherMaidenName', 'mother_maiden_name'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['zipcode', 'zipcode'],
  ['dob', 'dob'],
  ['ssn', 'ssn'],
  ['driverLicenseNumber', 'driver_license_number'],
  ['driverLicenseState', 'driver_license_state'],
  ['previousDriverLicenseNumber', 'previous_driver_license_number'],
  ['previousDriverLicenseState', 'previous_driver_license_state'],
  ['customId', 'custom_id'],
] as const satisfies ReadonlyArray<readonly [keyof CheckrCandidateFieldParams, string]>

/** Builds the snake_case candidate body shared by create and update. */
export function buildCandidateBody(params: CheckrCandidateFieldParams): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [param, field] of CANDIDATE_STRING_FIELDS) {
    const value = trimmed(params[param] as string | undefined)
    if (value) body[field] = value
  }
  if (typeof params.noMiddleName === 'boolean') body.no_middle_name = params.noMiddleName
  if (typeof params.copyRequested === 'boolean') body.copy_requested = params.copyRequested
  const geoIds = parseCheckrStringList(params.geoIds)
  if (geoIds) body.geo_ids = geoIds
  const metadata = parseCheckrObject(params.metadata, 'metadata')
  if (metadata) body.metadata = metadata
  const postalAddress = parseCheckrObject(params.postalAddress, 'postalAddress')
  if (postalAddress) body.postal_address = postalAddress
  return body
}

export const CANDIDATE_FIELD_PARAMS = {
  firstName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: "Candidate's first name",
  },
  middleName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: "Candidate's middle name (required to order a report unless noMiddleName is true)",
  },
  noMiddleName: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Set to true when the candidate has no middle name',
  },
  lastName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: "Candidate's last name",
  },
  motherMaidenName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: "Candidate's mother's maiden name",
  },
  phone: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: "Candidate's phone number (a mobile number is recommended for identity checks)",
  },
  zipcode: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: "Candidate's 5-digit zip code (required for criminal screenings)",
  },
  dob: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Date of birth in YYYY-MM-DD format',
  },
  ssn: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Social Security Number, e.g. 111-11-2001 (required for criminal screenings)',
  },
  driverLicenseNumber: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Driver license number (required for motor vehicle reports)',
  },
  driverLicenseState: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Driver license issuing state as a two-letter code, e.g. CA',
  },
  previousDriverLicenseNumber: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Previous driver license number',
  },
  previousDriverLicenseState: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Previous driver license issuing state as a two-letter code',
  },
  copyRequested: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Whether the candidate wants a copy of their report',
  },
  customId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Your own unique ID for the candidate, such as an HRIS ID',
  },
  geoIds: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Geo IDs to assign, as an array or comma-separated list (replaces existing geos)',
  },
  metadata: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description: 'Up to 50 custom key-value pairs as a JSON object',
  },
  postalAddress: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm' as ParameterVisibility,
    description:
      'Postal address as a JSON object with name, street, street2, city, state, and zipcode',
  },
}
