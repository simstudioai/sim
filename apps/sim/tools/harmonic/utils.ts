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
  HarmonicSocialMetadata,
} from '@/tools/harmonic/types'

export const HARMONIC_API_BASE = 'https://api.harmonic.ai'
export const HARMONIC_PAGE_SIZE_DEFAULT = 50
export const HARMONIC_PAGE_SIZE_MAX = 100
export const HARMONIC_BATCH_PEOPLE_MAX = 500

const PERSON_URN_PATTERN = /^urn:harmonic:person:[^\s]+$/

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
  apiKey: string,
  options: { json?: boolean } = {}
): Record<string, string> {
  return {
    apikey: apiKey,
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value) : []
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

export function parsePersonUrns(value: unknown, paramName = 'personUrns'): string[] {
  return uniqueStrings(
    parseArrayParam(value, paramName).map((urn) => requirePersonUrn(urn, paramName))
  )
}

export function parsePersonIds(value: unknown): number[] {
  const ids = parseArrayParam(value, 'personIds').map((id) => {
    const normalized = typeof id === 'string' ? id.trim() : id
    const parsed =
      typeof normalized === 'number'
        ? normalized
        : typeof normalized === 'string' && normalized
          ? Number(normalized)
          : Number.NaN
    if (!Number.isInteger(parsed)) {
      throw new Error('Harmonic "personIds" must contain only integer IDs')
    }
    return parsed
  })
  return [...new Set(ids)]
}

export function clampPageSize(value: unknown): number {
  if (value === undefined || value === null || value === '') return HARMONIC_PAGE_SIZE_DEFAULT
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error('Harmonic "size" must be an integer')
  }
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
  const ids = parsePersonIds(personIds)
  const urns = parsePersonUrns(personUrns)
  const total = ids.length + urns.length
  if (total === 0) {
    throw new Error('Harmonic Batch Get People requires at least one person ID or person URN')
  }
  if (total > HARMONIC_BATCH_PEOPLE_MAX) {
    throw new Error(`Harmonic Batch Get People accepts at most ${HARMONIC_BATCH_PEOPLE_MAX} people`)
  }
  return { ids, urns }
}

function currentExperience(raw: HarmonicPersonOutput): HarmonicExperienceMetadata[] {
  return Array.isArray(raw.experience)
    ? raw.experience.filter((experience) => experience?.is_current_position === true)
    : []
}

function linkedinUrl(socials: HarmonicPersonOutput['socials']): string | null {
  if (!socials) return null
  for (const [network, metadata] of Object.entries(socials)) {
    const url = asString((metadata as HarmonicSocialMetadata | undefined)?.url)
    if (url && (network.toLowerCase().includes('linkedin') || url.includes('linkedin.com'))) {
      return url
    }
  }
  return null
}

export function normalizePerson(raw: HarmonicPersonOutput): HarmonicContact {
  const contact = asRecord(raw.contact) ?? {}
  const location = (asRecord(raw.location) ?? {}) as HarmonicLocationMetadata
  const experiences = currentExperience(raw)
  const primaryEmail = asString(contact.primary_email)
  const emails = uniqueStrings([
    primaryEmail,
    ...stringArray(contact.emails),
    ...stringArray(contact.exec_emails),
  ])
  const currentTitles = uniqueStrings(experiences.map((experience) => experience.title))
  const currentCompanyNames = uniqueStrings(
    experiences.map((experience) => experience.company_name)
  )
  const currentCompanyUrns = uniqueStrings([
    ...stringArray(raw.current_company_urns),
    ...experiences.map((experience) => experience.company),
  ]).filter((urn) => urn.startsWith('urn:harmonic:company:'))

  return {
    personUrn: personUrn(raw.entity_urn),
    personId: asNumber(raw.id),
    fullName: asString(raw.full_name),
    firstName: asString(raw.first_name),
    lastName: asString(raw.last_name),
    headline: asString(raw.linkedin_headline),
    currentTitles,
    currentCompanyNames,
    currentCompanyUrns,
    primaryEmail,
    emails,
    phoneNumbers: stringArray(contact.phone_numbers),
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
    currentTitles: title ? [title] : [],
    currentCompanyNames: company ? [company] : [],
    currentCompanyUrns: [],
    primaryEmail: email,
    emails: email ? [email] : [],
    phoneNumbers: [],
    linkedinUrl: asString(raw.linkedin_url),
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
  const pageInfo = asRecord(value) as HarmonicPaginationMetadata | null
  if (!pageInfo) return null
  return {
    nextCursor: asOpaqueString(pageInfo.next),
    currentCursor: asOpaqueString(pageInfo.current),
    hasNext: pageInfo.has_next === true,
  }
}

export function normalizeSavedSearch(raw: HarmonicSavedSearchOutput): HarmonicSavedSearch {
  return {
    savedSearchId: asNumber(raw.id),
    savedSearchUrn: asString(raw.entity_urn),
    name: asString(raw.name),
    isPrivate: asBoolean(raw.is_private),
    savedSearchType: asString(raw.type),
    userSavedSearchType: asString(raw.user_saved_search_type),
    creatorUrn: asString(raw.creator),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
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
