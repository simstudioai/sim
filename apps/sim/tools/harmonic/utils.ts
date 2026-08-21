import type {
  HarmonicContact,
  HarmonicDroppedIdentifier,
  HarmonicEmailJobCounts,
  HarmonicEmailJobItem,
  HarmonicEnrichmentOutput,
  HarmonicEnrichmentStatus,
  HarmonicExperienceMetadata,
  HarmonicLocationMetadata,
  HarmonicPageInfo,
  HarmonicPaginationMetadata,
  HarmonicPersonOutput,
  HarmonicSavedSearch,
  HarmonicSavedSearchOutput,
  HarmonicScoutPerson,
} from '@/tools/harmonic/types'

export const HARMONIC_API_BASE = 'https://api.harmonic.ai'
export const HARMONIC_PAGE_SIZE_DEFAULT = 50
export const HARMONIC_PAGE_SIZE_MAX = 100
export const HARMONIC_BATCH_PEOPLE_MAX = 500
export const HARMONIC_EMAIL_ENRICHMENT_MAX = 5000
export const HARMONIC_ENRICHMENT_STATUS_MAX = 500
export const HARMONIC_CLEAR_NET_NEW_MAX = 500
export const HARMONIC_EMPLOYEE_GROUP_TYPES = [
  'CEO',
  'FOUNDERS_AND_CEO',
  'EXECUTIVES',
  'FOUNDERS',
  'LEADERSHIP',
  'NON_LEADERSHIP',
  'ALL',
  'ADVISORS',
  'NON_PARTNERS',
] as const
export const HARMONIC_EMPLOYEE_STATUSES = ['ACTIVE', 'NOT_ACTIVE', 'ACTIVE_AND_NOT_ACTIVE'] as const
/** Harmonic documents per-user connection filtering as unsupported via the API. */
export const HARMONIC_USER_CONNECTION_STATUSES = ['TEAM_CONNECTION', 'NO_CONNECTION'] as const
/** Terminal states for a bulk email-enrichment job; `results` stays null until one is reached. */
export const HARMONIC_EMAIL_JOB_TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED'])
export const HARMONIC_PERSON_INCLUDE_FIELDS = [
  'entity_urn',
  'id',
  'full_name',
  'first_name',
  'last_name',
  'profile_picture_url',
  'contact',
  'location',
  'socials',
  'experience',
  'linkedin_headline',
  'current_company_urns',
  'is_redacted',
] as const

const PERSON_URN_PATTERN = /^urn:harmonic:person:[^\s]+$/
const SAVED_SEARCH_URN_PATTERN = /^urn:harmonic:saved_search:[^\s]+$/
const USER_URN_PATTERN = /^urn:harmonic:user:[^\s]+$/
const ENRICHMENT_URN_PATTERN = /^urn:harmonic:enrichment:[^\s]+$/
const COMPANY_URN_PATTERN = /^urn:harmonic:company:[^\s]+$/
const COMPANY_OR_PERSON_URN_PATTERN = /^urn:harmonic:(company|person):[^\s]+$/
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAFE_DECIMAL_INTEGER_PATTERN = /^-?\d+$/
const RFC3339_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/
/** UTC dates that ended in a leap second, through IERS Bulletin C 72 (July 2026). */
const KNOWN_UTC_LEAP_SECOND_DATES = new Set([
  '1972-06-30',
  '1972-12-31',
  '1973-12-31',
  '1974-12-31',
  '1975-12-31',
  '1976-12-31',
  '1977-12-31',
  '1978-12-31',
  '1979-12-31',
  '1981-06-30',
  '1982-06-30',
  '1983-06-30',
  '1985-06-30',
  '1987-12-31',
  '1989-12-31',
  '1990-12-31',
  '1992-06-30',
  '1993-06-30',
  '1994-06-30',
  '1995-12-31',
  '1997-06-30',
  '1998-12-31',
  '2005-12-31',
  '2008-12-31',
  '2012-06-30',
  '2015-06-30',
  '2016-12-31',
])
const HARMONIC_USER_SAVED_SEARCH_TYPES = new Set([
  'USER_CREATED',
  'GENERATED_FROM_PREFERENCES',
  'TEMPLATE_FROM_PREFERENCES',
])

/**
 * Scout returns `content` as an object matching this schema when the request succeeds.
 * Keeping the schema integration-owned gives every workflow the same downstream table shape.
 */
export const HARMONIC_SCOUT_PEOPLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    people: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: "The person's full name" },
          linkedin_url: { type: 'string', description: "The person's LinkedIn profile URL" },
          person_urn: { type: 'string', description: "The person's Harmonic URN" },
          title: { type: 'string', description: "The person's current job title" },
          company: { type: 'string', description: "The person's current company" },
          location: { type: 'string', description: "The person's location" },
          email: { type: 'string', description: "The person's email address" },
          one_liner: {
            type: 'string',
            description: 'A brief explanation of why the person matches the request',
          },
        },
        required: ['name'],
      },
    },
  },
  required: ['people'],
} as const

export function harmonicHeaders(
  accessToken: string,
  options: { json?: boolean } = {}
): Record<string, string> {
  return {
    apikey: accessToken,
    Accept: 'application/json',
    ...(options.json ? { 'Content-Type': 'application/json' } : {}),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function asOpaqueString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = asString(value)
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }
  return result
}

function nullableStringArray(value: unknown): string[] | null {
  return Array.isArray(value) ? uniqueStrings(value) : null
}

function personUrn(value: unknown): string | null {
  const normalized = asString(value)
  return normalized && PERSON_URN_PATTERN.test(normalized) ? normalized : null
}

function requirePersonUrn(value: unknown, paramName: string): string {
  const normalized = personUrn(value)
  if (!normalized) {
    throw new Error(`Harmonic "${paramName}" must contain only person URNs`)
  }
  return normalized
}

function requirePersonId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && UUID_PATTERN.test(value)) return null
  throw new Error('Harmonic returned a person record with an invalid ID')
}

function requireSavedSearchUrn(value: unknown): string {
  const normalized = asString(value)
  if (!normalized || !SAVED_SEARCH_URN_PATTERN.test(normalized)) {
    throw new Error('Harmonic returned a people saved search with an invalid entity URN')
  }
  return normalized
}

function requireSavedSearchString(value: unknown, field: string): string {
  const normalized = asString(value)
  if (!normalized) {
    throw new Error(`Harmonic returned a people saved search without a valid ${field}`)
  }
  return normalized
}

function requireUserUrn(value: unknown): string {
  const normalized = requireSavedSearchString(value, 'creator')
  if (!USER_URN_PATTERN.test(normalized)) {
    throw new Error('Harmonic returned a people saved search with an invalid creator URN')
  }
  return normalized
}

/**
 * Passed through rather than checked against a fixed set. This value is display
 * metadata that nothing downstream branches on, and Harmonic owns the enum — an
 * allow-list would turn any value they add into a hard failure of the entire list,
 * while the selector reading the same rows kept working.
 */
function requireUserSavedSearchType(value: unknown): string {
  return requireSavedSearchString(value, 'user_saved_search_type')
}

function requireSavedSearchTimestamp(value: unknown, field: string): string {
  const normalized = requireSavedSearchString(value, field)
  const match = RFC3339_DATE_TIME_PATTERN.exec(normalized)
  if (!match) {
    throw new Error(`Harmonic returned a people saved search with an invalid ${field}`)
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    utcDesignator,
    offsetSign,
    offsetHourText,
    offsetMinuteText,
  ] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText)
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText)
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 60 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new Error(`Harmonic returned a people saved search with an invalid ${field}`)
  }

  if (second === 60) {
    if (year < 1972) {
      throw new Error(`Harmonic returned a people saved search with an invalid ${field}`)
    }
    const offsetMinutes = utcDesignator
      ? 0
      : (offsetSign === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute)
    const precedingUtcSecond = new Date(
      Date.UTC(year, month - 1, day, hour, minute, 59) - offsetMinutes * 60_000
    )
    const leapSecondDate = precedingUtcSecond.toISOString().slice(0, 10)
    if (
      precedingUtcSecond.getUTCHours() !== 23 ||
      precedingUtcSecond.getUTCMinutes() !== 59 ||
      precedingUtcSecond.getUTCSeconds() !== 59 ||
      !KNOWN_UTC_LEAP_SECOND_DATES.has(leapSecondDate)
    ) {
      throw new Error(`Harmonic returned a people saved search with an invalid ${field}`)
    }
  }
  return normalized
}

function parseArrayParam(value: unknown, paramName: string): unknown[] {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return value

  if (typeof value === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`Harmonic "${paramName}" must be a JSON array`)
    }
    if (Array.isArray(parsed)) return parsed
  }

  throw new Error(`Harmonic "${paramName}" must be a JSON array`)
}

function parseSafeDecimalInteger(value: unknown, paramName: string): number {
  let parsed: number
  if (typeof value === 'number') {
    parsed = value
  } else if (typeof value === 'string') {
    const normalized = value.trim()
    if (!SAFE_DECIMAL_INTEGER_PATTERN.test(normalized)) {
      throw new Error(`Harmonic "${paramName}" must be a safe decimal integer`)
    }
    parsed = Number(normalized)
  } else {
    throw new Error(`Harmonic "${paramName}" must be a safe decimal integer`)
  }

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Harmonic "${paramName}" must be a safe decimal integer`)
  }
  return parsed
}

function normalizePersonUrns(values: unknown[], paramName: string): string[] {
  return [...new Set(values.map((urn) => requirePersonUrn(urn, paramName)))]
}

function normalizePersonIds(values: unknown[]): number[] {
  return [...new Set(values.map((id) => parseSafeDecimalInteger(id, 'personIds')))]
}

export function parsePersonUrns(value: unknown, paramName = 'personUrns'): string[] {
  return normalizePersonUrns(parseArrayParam(value, paramName), paramName)
}

export function clampPageSize(value: unknown): number {
  if (value === undefined || value === null || value === '') return HARMONIC_PAGE_SIZE_DEFAULT
  const parsed = parseSafeDecimalInteger(value, 'size')
  return Math.min(Math.max(parsed, 1), HARMONIC_PAGE_SIZE_MAX)
}

export function requireIdentifier(value: unknown, paramName: string): string {
  const normalized = asString(value)
  if (!normalized) throw new Error(`Harmonic "${paramName}" is required`)
  return normalized
}

export function buildPagedUrl(path: string, size: unknown, cursor?: unknown): string {
  const url = new URL(`${HARMONIC_API_BASE}${path}`)
  url.searchParams.set('size', String(clampPageSize(size)))
  const normalizedCursor = asOpaqueString(cursor)
  if (normalizedCursor) url.searchParams.set('cursor', normalizedCursor)
  return url.toString()
}

export function buildScoutBody(query: unknown): Record<string, unknown> {
  const input = requireIdentifier(query, 'query')
  return { input, json_schema: HARMONIC_SCOUT_PEOPLE_SCHEMA }
}

export function buildBatchGetPeopleBody(
  personIds: unknown,
  personUrns: unknown
): Record<string, unknown> {
  const rawIds = parseArrayParam(personIds, 'personIds')
  const rawUrns = parseArrayParam(personUrns, 'personUrns')
  const rawTotal = rawIds.length + rawUrns.length
  if (rawTotal === 0) {
    throw new Error('Harmonic Batch Get People requires at least one person ID or person URN')
  }
  if (rawTotal > HARMONIC_BATCH_PEOPLE_MAX) {
    throw new Error(`Harmonic Batch Get People accepts at most ${HARMONIC_BATCH_PEOPLE_MAX} people`)
  }

  return {
    ids: normalizePersonIds(rawIds),
    urns: normalizePersonUrns(rawUrns, 'personUrns'),
    include_fields: [...HARMONIC_PERSON_INCLUDE_FIELDS],
  }
}

function currentExperience(raw: HarmonicPersonOutput): HarmonicExperienceMetadata[] | null {
  if (!Array.isArray(raw.experience)) return null
  return raw.experience.filter((experience) => experience?.is_current_position === true)
}

function normalizeLinkedinProfileUrl(value: unknown): string | null {
  const rawUrl = asString(value)
  if (!rawUrl) return null

  try {
    const url = new URL(rawUrl)
    const hostname = url.hostname.toLowerCase()
    const isLinkedinHost = hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com')
    const [, profileKind, profileSlug] = url.pathname.split('/')

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !isLinkedinHost ||
      (profileKind !== 'in' && profileKind !== 'pub') ||
      !profileSlug
    ) {
      return null
    }

    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function linkedinUrl(socials: HarmonicPersonOutput['socials']): string | null {
  const socialRecord = asRecord(socials)
  if (!socialRecord) return null

  for (const metadata of Object.values(socialRecord)) {
    const normalized = normalizeLinkedinProfileUrl(asRecord(metadata)?.url)
    if (normalized) return normalized
  }
  return null
}

export function normalizePerson(raw: HarmonicPersonOutput): HarmonicContact {
  const normalizedPersonId = requirePersonId(raw.id)
  const contact = asRecord(raw.contact)
  const location = (asRecord(raw.location) ?? {}) as HarmonicLocationMetadata
  const experiences = currentExperience(raw)
  const primaryEmail = asString(contact?.primary_email)
  const contactEmails = nullableStringArray(contact?.emails)
  const executiveEmails = nullableStringArray(contact?.exec_emails)
  const emails =
    primaryEmail || contactEmails !== null || executiveEmails !== null
      ? uniqueStrings([primaryEmail, ...(contactEmails ?? []), ...(executiveEmails ?? [])])
      : null
  const currentTitles = experiences
    ? uniqueStrings(experiences.map((experience) => experience.title))
    : null
  const currentCompanyNames = experiences
    ? uniqueStrings(experiences.map((experience) => experience.company_name))
    : null
  const personCompanyUrns = nullableStringArray(raw.current_company_urns)
  const currentCompanyUrns =
    personCompanyUrns !== null || experiences !== null
      ? uniqueStrings([
          ...(personCompanyUrns ?? []),
          ...(experiences ?? []).map((experience) => experience.company),
        ]).filter((urn) => urn.startsWith('urn:harmonic:company:'))
      : null

  return {
    personUrn: personUrn(raw.entity_urn),
    personId: normalizedPersonId,
    fullName: asString(raw.full_name),
    firstName: asString(raw.first_name),
    lastName: asString(raw.last_name),
    headline: asString(raw.linkedin_headline) ?? currentTitles?.[0] ?? null,
    currentTitles,
    currentCompanyNames,
    currentCompanyUrns,
    primaryEmail,
    emails,
    phoneNumbers: nullableStringArray(contact?.phone_numbers),
    linkedinUrl: linkedinUrl(raw.socials),
    formattedLocation: asString(location.address_formatted) ?? asString(location.location),
    city: asString(location.city),
    state: asString(location.state),
    country: asString(location.country),
    profilePictureUrl: asString(raw.profile_picture_url),
    summary: null,
    isRedacted: asBoolean(raw.is_redacted),
  }
}

export function normalizeScoutPerson(raw: HarmonicScoutPerson): HarmonicContact {
  const name = asString(raw.name)
  if (!name) throw new Error('Harmonic Scout returned a person without the required name')
  const title = asString(raw.title)
  const company = asString(raw.company)
  const email = asString(raw.email)

  return {
    personUrn: personUrn(raw.person_urn),
    personId: null,
    fullName: name,
    firstName: null,
    lastName: null,
    headline: title,
    currentTitles: title ? [title] : null,
    currentCompanyNames: company ? [company] : null,
    currentCompanyUrns: null,
    primaryEmail: email,
    emails: email ? [email] : null,
    phoneNumbers: null,
    linkedinUrl: normalizeLinkedinProfileUrl(raw.linkedin_url),
    formattedLocation: asString(raw.location),
    city: null,
    state: null,
    country: null,
    profilePictureUrl: null,
    summary: asString(raw.one_liner),
    isRedacted: null,
  }
}

export function normalizePageInfo(value: unknown): HarmonicPageInfo | null {
  if (value === undefined || value === null) return null
  const pageInfo = asRecord(value) as HarmonicPaginationMetadata | null
  if (!pageInfo) throw new Error('Harmonic returned invalid page_info metadata')
  if (typeof pageInfo.has_next !== 'boolean') {
    throw new Error('Harmonic returned page_info without a boolean has_next value')
  }

  const cursor = (cursorValue: unknown, field: string): string | null => {
    if (cursorValue === undefined || cursorValue === null) return null
    if (typeof cursorValue !== 'string') {
      throw new Error(`Harmonic returned page_info.${field} with a non-string cursor`)
    }
    return cursorValue
  }

  return {
    nextCursor: cursor(pageInfo.next, 'next'),
    currentCursor: cursor(pageInfo.current, 'current'),
    hasNext: pageInfo.has_next,
  }
}

export function normalizeSavedSearch(raw: HarmonicSavedSearchOutput): HarmonicSavedSearch {
  if (raw.type !== 'PERSONS') {
    throw new Error('Harmonic returned a saved search that does not target people')
  }

  if (typeof raw.id !== 'number' || !Number.isSafeInteger(raw.id)) {
    throw new Error('Harmonic returned a people saved search with an invalid numeric ID')
  }
  const savedSearchId = raw.id
  const savedSearchUrn = requireSavedSearchUrn(raw.entity_urn)
  const name = asString(raw.name)
  if (!name) throw new Error('Harmonic returned a people saved search without a name')

  return {
    savedSearchId,
    savedSearchUrn,
    name,
    isPrivate: asBoolean(raw.is_private),
    savedSearchType: 'PERSONS',
    userSavedSearchType: requireUserSavedSearchType(raw.user_saved_search_type),
    creatorUrn: requireUserUrn(raw.creator),
    createdAt: requireSavedSearchTimestamp(raw.created_at, 'created_at'),
    updatedAt: requireSavedSearchTimestamp(raw.updated_at, 'updated_at'),
  }
}

export function normalizePeopleResults(value: unknown): {
  contacts: HarmonicContact[]
  personUrns: string[]
} {
  if (!Array.isArray(value)) throw new Error('Harmonic returned an invalid people results array')

  const contacts: HarmonicContact[] = []
  const urns: string[] = []
  for (const result of value) {
    if (typeof result === 'string') {
      urns.push(requirePersonUrn(result, 'results'))
      continue
    }

    const person = asRecord(result) as HarmonicPersonOutput | null
    const urn = personUrn(person?.entity_urn)
    if (!person || !urn) {
      throw new Error('Harmonic saved search returned a non-person result')
    }
    contacts.push(normalizePerson(person))
    urns.push(urn)
  }

  return { contacts, personUrns: uniqueStrings(urns) }
}

export function normalizePersonArray(value: unknown): HarmonicContact[] {
  if (!Array.isArray(value)) throw new Error('Harmonic returned an invalid people array')
  return value.map((item) => {
    const person = asRecord(item) as HarmonicPersonOutput | null
    if (!person || !personUrn(person.entity_urn)) {
      throw new Error('Harmonic returned an invalid person record')
    }
    return normalizePerson(person)
  })
}

export function responseRecord(value: unknown, context: string): Record<string, unknown> {
  const record = asRecord(value)
  if (!record) throw new Error(`Harmonic returned an invalid ${context} response`)
  return record
}

export function responseArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Harmonic returned an invalid ${context} response`)
  return value
}

export function nullableResponseNumber(value: unknown): number | null {
  return asNumber(value)
}

export function nullableResponseString(value: unknown): string | null {
  return asString(value)
}

function requireResponseString(value: unknown, context: string): string {
  const normalized = asString(value)
  if (!normalized) throw new Error(`Harmonic returned ${context} without a valid value`)
  return normalized
}

function requireResponseNumber(value: unknown, context: string): number {
  const normalized = asNumber(value)
  if (normalized === null || !Number.isSafeInteger(normalized)) {
    throw new Error(`Harmonic returned ${context} without a valid count`)
  }
  return normalized
}

function enumOption(
  value: unknown,
  allowed: readonly string[],
  paramName: string
): string | undefined {
  const normalized = asString(value)
  if (!normalized) return undefined
  const match = allowed.find((option) => option === normalized.toUpperCase())
  if (!match) {
    throw new Error(`Harmonic "${paramName}" must be one of: ${allowed.join(', ')}`)
  }
  return match
}

/**
 * Harmonic accepts `YYYY-MM-DD` or `YYYY-MM-DDTHH:00:00Z` here. Anything else is
 * rejected locally so a malformed filter cannot silently widen the delta window.
 */
export function normalizeNewResultsSince(value: unknown): string | undefined {
  const normalized = asString(value)
  if (!normalized) return undefined
  if (DATE_ONLY_PATTERN.test(normalized)) return normalized
  if (RFC3339_DATE_TIME_PATTERN.test(normalized)) return normalized
  throw new Error(
    'Harmonic "newResultsSince" must be YYYY-MM-DD or an RFC 3339 timestamp such as 2026-01-31T00:00:00Z'
  )
}

export function buildEnrichPersonUrl(linkedinUrl: unknown, email: unknown): string {
  const normalizedLinkedin = asString(linkedinUrl)
  const normalizedEmail = asString(email)
  if (!normalizedLinkedin && !normalizedEmail) {
    throw new Error('Harmonic Enrich Person requires a LinkedIn profile URL or an email address')
  }

  const url = new URL(`${HARMONIC_API_BASE}/persons`)
  if (normalizedLinkedin) url.searchParams.set('linkedin_url', normalizedLinkedin)
  if (normalizedEmail) url.searchParams.set('email', normalizedEmail)
  return url.toString()
}

export function buildGetPersonUrl(personId: unknown, companyContextUrns: unknown): string {
  const url = new URL(
    `${HARMONIC_API_BASE}/persons/${encodeURIComponent(requireIdentifier(personId, 'personId'))}`
  )
  for (const urn of uniqueStrings(parseArrayParam(companyContextUrns, 'companyContextUrns'))) {
    if (!COMPANY_URN_PATTERN.test(urn)) {
      throw new Error('Harmonic "companyContextUrns" must contain only company URNs')
    }
    url.searchParams.append('company_context_urns', urn)
  }
  return url.toString()
}

export function buildCompanyEmployeesUrl(
  companyId: unknown,
  options: {
    employeeGroupType?: unknown
    employeeStatus?: unknown
    userConnectionStatus?: unknown
    size?: unknown
    cursor?: unknown
  }
): string {
  const url = new URL(
    `${HARMONIC_API_BASE}/companies/${encodeURIComponent(
      requireIdentifier(companyId, 'companyId')
    )}/employees`
  )
  url.searchParams.set('size', String(clampPageSize(options.size)))
  const groupType = enumOption(
    options.employeeGroupType,
    HARMONIC_EMPLOYEE_GROUP_TYPES,
    'employeeGroupType'
  )
  if (groupType) url.searchParams.set('employee_group_type', groupType)
  const status = enumOption(options.employeeStatus, HARMONIC_EMPLOYEE_STATUSES, 'employeeStatus')
  if (status) url.searchParams.set('employee_status', status)
  const connection = enumOption(
    options.userConnectionStatus,
    HARMONIC_USER_CONNECTION_STATUSES,
    'userConnectionStatus'
  )
  if (connection) url.searchParams.set('user_connection_status', connection)
  const cursor = asOpaqueString(options.cursor)
  if (cursor) url.searchParams.set('cursor', cursor)
  return url.toString()
}

export function buildNetNewResultsUrl(
  savedSearchId: unknown,
  size: unknown,
  cursor: unknown,
  newResultsSince: unknown
): string {
  const url = new URL(
    `${HARMONIC_API_BASE}/savedSearches/${encodeURIComponent(
      requireIdentifier(savedSearchId, 'savedSearchId')
    )}/net_new_results`
  )
  url.searchParams.set('size', String(clampPageSize(size)))
  const normalizedCursor = asOpaqueString(cursor)
  if (normalizedCursor) url.searchParams.set('cursor', normalizedCursor)
  const since = normalizeNewResultsSince(newResultsSince)
  if (since) url.searchParams.set('new_results_since', since)
  return url.toString()
}

/**
 * Omitting `entity_urns` tells Harmonic to clear the entire net-new queue, so an
 * empty URN list must never reach the wire by accident. Clearing everything has to
 * be asked for explicitly through `clearScope`.
 */
export function buildClearNetNewResultsUrl(
  savedSearchId: unknown,
  personUrns: unknown,
  clearScope: unknown
): string {
  const url = new URL(
    `${HARMONIC_API_BASE}/savedSearches/${encodeURIComponent(
      requireIdentifier(savedSearchId, 'savedSearchId')
    )}/clear_net_new_results`
  )

  const scope = asString(clearScope) ?? 'selected'
  if (scope !== 'selected' && scope !== 'all') {
    throw new Error('Harmonic "clearScope" must be either "selected" or "all"')
  }

  const urns = parsePersonUrns(personUrns)
  if (scope === 'all') {
    if (urns.length > 0) {
      throw new Error(
        'Harmonic Clear Net-New Results cannot combine specific person URNs with clearing everything'
      )
    }
    return url.toString()
  }

  if (urns.length === 0) {
    throw new Error(
      'Harmonic Clear Net-New Results requires at least one person URN, or clearScope set to "all" to clear every net-new result'
    )
  }
  if (urns.length > HARMONIC_CLEAR_NET_NEW_MAX) {
    throw new Error(
      `Sim sends at most ${HARMONIC_CLEAR_NET_NEW_MAX} person URNs per Harmonic clear request to bound the query string; split the batch`
    )
  }
  for (const urn of urns) url.searchParams.append('entity_urns', urn)
  return url.toString()
}

export function buildEnrichmentStatusUrl(enrichmentUrns: unknown): string {
  const urns = uniqueStrings(parseArrayParam(enrichmentUrns, 'enrichmentUrns'))
  if (urns.length === 0) {
    throw new Error('Harmonic Get Enrichment Status requires at least one enrichment URN')
  }
  if (urns.length > HARMONIC_ENRICHMENT_STATUS_MAX) {
    throw new Error(
      `Sim sends at most ${HARMONIC_ENRICHMENT_STATUS_MAX} enrichment identifiers per Harmonic request to bound the query string; split the batch`
    )
  }

  /** Harmonic documents both the bare enrichment UUID (`ids`) and the full URN (`urns`). */
  const url = new URL(`${HARMONIC_API_BASE}/enrichment_status`)
  for (const urn of urns) {
    if (ENRICHMENT_URN_PATTERN.test(urn)) {
      url.searchParams.append('urns', urn)
    } else if (UUID_PATTERN.test(urn)) {
      url.searchParams.append('ids', urn)
    } else {
      throw new Error(
        'Harmonic "enrichmentUrns" must contain enrichment URNs or bare enrichment UUIDs'
      )
    }
  }
  return url.toString()
}

/**
 * `linkedin.com/in/x`, `www.linkedin.com/in/x` and a trailing slash all name one
 * profile, so a recognized profile folds to a host-and-path key. Regional
 * subdomains (`uk.linkedin.com`) are deliberately left distinct: folding them
 * would claim an equivalence Harmonic does not document.
 *
 * This key is only ever applied to a URL `normalizeLinkedinProfileUrl` already
 * canonicalized — one with no query or fragment left. A URL forwarded verbatim for
 * Harmonic to adjudicate keeps every component significant, so it deduplicates on
 * its exact text; dropping the query or port there would silently discard a
 * distinct identifier the caller asked to submit.
 */
function linkedinProfileKey(canonicalUrl: string): string {
  try {
    const parsed = new URL(canonicalUrl)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    return `${host}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return canonicalUrl
  }
}

function dedupeByKey(entries: Array<{ url: string; key: string }>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of entries) {
    if (seen.has(entry.key)) continue
    seen.add(entry.key)
    result.push(entry.url)
  }
  return result
}

export function buildEmailEnrichmentJobBody(
  personUrns: unknown,
  personLinkedinUrls: unknown
): Record<string, unknown> {
  const urns = parsePersonUrns(personUrns)
  /**
   * Harmonic reports unusable entries per item as `dropped[].reason = INVALID_URL`
   * without consuming quota, so one odd URL must not fail the whole batch.
   * Recognisable profile URLs are canonicalised; anything else is forwarded intact
   * for Harmonic to adjudicate. Only values that are not absolute http(s) URLs at
   * all are rejected here, because those are a local mistake, not a provider call.
   */
  /**
   * Blank and non-string entries are dropped first so `['']` reads as "no LinkedIn
   * URLs supplied" rather than tripping the mutual-exclusivity check below or
   * failing the per-URL parse.
   */
  const rawLinkedinUrls = uniqueStrings(parseArrayParam(personLinkedinUrls, 'personLinkedinUrls'))

  /**
   * Harmonic documents these as mutually exclusive — "Provide exactly one of the
   * two arrays" — so sending both is rejected locally rather than letting the
   * provider silently pick one and bill for it. This runs before any per-URL work
   * so the clearer of the two errors wins when both problems are present.
   */
  if (urns.length > 0 && rawLinkedinUrls.length > 0) {
    throw new Error(
      'Harmonic Submit Email Enrichment Job accepts person URNs or LinkedIn URLs, not both'
    )
  }

  /**
   * Canonicalise first, then deduplicate. Harmonic canonicalizes and silently
   * deduplicates server-side and reserves quota afterwards, so this is not what
   * protects the bill — it keeps Sim's own 1-5000 accounting in step with the set
   * Harmonic will actually accept, so a batch of equivalent URLs is not rejected
   * locally for exceeding a cap it never reaches.
   */
  const linkedinUrls = dedupeByKey(
    rawLinkedinUrls.map((value) => {
      const normalized = normalizeLinkedinProfileUrl(value)
      if (normalized) return { url: normalized, key: linkedinProfileKey(normalized) }
      try {
        const parsed = new URL(String(value))
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('unsupported scheme')
        }
        return { url: String(value), key: String(value) }
      } catch {
        throw new Error(
          'Harmonic "personLinkedinUrls" must contain absolute http(s) URLs; Harmonic reports unmatched profiles in dropped'
        )
      }
    })
  )
  const identifiers = urns.length > 0 ? urns : linkedinUrls
  if (identifiers.length === 0) {
    throw new Error(
      'Harmonic Submit Email Enrichment Job requires at least one person URN or LinkedIn profile URL'
    )
  }
  if (identifiers.length > HARMONIC_EMAIL_ENRICHMENT_MAX) {
    throw new Error(
      `Harmonic Submit Email Enrichment Job accepts at most ${HARMONIC_EMAIL_ENRICHMENT_MAX} people`
    )
  }

  return urns.length > 0 ? { person_urns: urns } : { person_linkedin_urls: linkedinUrls }
}

export function normalizePersonUrnList(value: unknown, context: string): string[] {
  return uniqueStrings(responseArray(value, context).map((urn) => requirePersonUrn(urn, 'results')))
}

export function normalizeOptionalPerson(value: unknown): HarmonicContact | null {
  if (value === undefined || value === null) return null
  const person = asRecord(value)
  if (!person) throw new Error('Harmonic returned an invalid person record')
  return normalizePerson(person)
}

export function normalizeDroppedIdentifiers(value: unknown): HarmonicDroppedIdentifier[] {
  if (value === undefined || value === null) return []
  return responseArray(value, 'dropped identifiers').map((entry) => {
    const dropped = responseRecord(entry, 'dropped identifier')
    return {
      submittedIdentifier: requireResponseString(
        dropped.submitted_identifier,
        'a dropped identifier'
      ),
      reason: requireResponseString(dropped.reason, 'a dropped identifier reason'),
    }
  })
}

export function normalizeEmailJobCounts(value: unknown): HarmonicEmailJobCounts {
  const counts = responseRecord(value, 'email enrichment counts')
  return {
    totalProcessed: requireResponseNumber(counts.total_processed, 'total_processed'),
    totalSucceeded: requireResponseNumber(counts.total_succeeded, 'total_succeeded'),
    totalFailed: requireResponseNumber(counts.total_failed, 'total_failed'),
    totalSkipped: requireResponseNumber(counts.total_skipped, 'total_skipped'),
    totalNotFound: requireResponseNumber(counts.total_not_found, 'total_not_found'),
  }
}

export function normalizeEmailJobResults(value: unknown): HarmonicEmailJobItem[] | null {
  if (value === undefined || value === null) return null
  return responseArray(value, 'email enrichment results').map((entry) => {
    const item = responseRecord(entry, 'email enrichment result')
    return {
      personUrn: requirePersonUrn(item.person_urn, 'results'),
      status: requireResponseString(item.status, 'an email enrichment result status'),
    }
  })
}

export function normalizeEnrichmentStatuses(value: unknown): HarmonicEnrichmentStatus[] {
  return responseArray(value, 'enrichment statuses').map((entry) => {
    const record = responseRecord(entry, 'enrichment status') as HarmonicEnrichmentOutput
    const enrichedEntityUrn = asString(record.enriched_entity_urn)
    if (enrichedEntityUrn && !COMPANY_OR_PERSON_URN_PATTERN.test(enrichedEntityUrn)) {
      throw new Error('Harmonic returned an enrichment status with an invalid entity URN')
    }
    return {
      enrichmentUrn: asString(record.entity_urn),
      status: asString(record.status),
      message: asString(record.message),
      enrichedEntityUrn,
    }
  })
}
