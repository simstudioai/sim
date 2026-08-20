import type {
  HarmonicContact,
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

function requireUserSavedSearchType(value: unknown): string {
  const normalized = requireSavedSearchString(value, 'user_saved_search_type')
  if (!HARMONIC_USER_SAVED_SEARCH_TYPES.has(normalized)) {
    throw new Error(
      'Harmonic returned a people saved search with an invalid user_saved_search_type'
    )
  }
  return normalized
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

export function parsePersonIds(value: unknown): number[] {
  return normalizePersonIds(parseArrayParam(value, 'personIds'))
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
