import type { ToolResponse } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const PEOPLE_API_BASE = 'https://people.googleapis.com/v1'

export const DEFAULT_PERSON_FIELDS =
  'names,emailAddresses,phoneNumbers,organizations,addresses,biographies,urls,photos,metadata,birthdays,events,nicknames,relations,userDefined,memberships'

interface BaseGoogleContactsParams {
  accessToken: string
}

export interface GoogleContactsCreateParams extends BaseGoogleContactsParams {
  givenName: string
  familyName?: string
  email?: string
  emailType?: 'home' | 'work' | 'other'
  phone?: string
  phoneType?: 'mobile' | 'home' | 'work' | 'other'
  organization?: string
  jobTitle?: string
  notes?: string
  birthday?: string
}

export interface GoogleContactsGetParams extends BaseGoogleContactsParams {
  resourceName: string
}

export interface GoogleContactsListParams extends BaseGoogleContactsParams {
  pageSize?: number
  pageToken?: string
  sortOrder?:
    | 'LAST_MODIFIED_ASCENDING'
    | 'LAST_MODIFIED_DESCENDING'
    | 'FIRST_NAME_ASCENDING'
    | 'LAST_NAME_ASCENDING'
}

export interface GoogleContactsUpdateParams extends BaseGoogleContactsParams {
  resourceName: string
  etag: string
  givenName?: string
  familyName?: string
  email?: string
  emailType?: 'home' | 'work' | 'other'
  phone?: string
  phoneType?: 'mobile' | 'home' | 'work' | 'other'
  organization?: string
  jobTitle?: string
  notes?: string
  birthday?: string
}

export interface GoogleContactsDeleteParams extends BaseGoogleContactsParams {
  resourceName: string
}

export interface GoogleContactsSearchParams extends BaseGoogleContactsParams {
  query: string
  pageSize?: number
}

interface ContactMetadata {
  resourceName: string
  etag: string
  displayName: string | null
  givenName: string | null
  familyName: string | null
  middleName: string | null
  emails: Array<{ value: string; type: string; displayName: string | null }> | null
  phones: Array<{ value: string; type: string; canonicalForm: string | null }> | null
  organizations: Array<{
    name: string
    title: string
    department: string | null
    location: string | null
  }> | null
  addresses: Array<{
    formattedValue: string
    type: string
    streetAddress: string | null
    extendedAddress: string | null
    poBox: string | null
    city: string | null
    region: string | null
    postalCode: string | null
    country: string | null
    countryCode: string | null
  }> | null
  biographies: Array<{ value: string }> | null
  urls: Array<{ value: string; type: string }> | null
  photos: Array<{ url: string }> | null
  birthdays: Array<{ date: string | null; text: string | null }> | null
  events: Array<{ type: string; date: string | null }> | null
  nicknames: Array<{ value: string }> | null
  relations: Array<{ person: string; type: string }> | null
  userDefined: Array<{ key: string; value: string }> | null
  contactGroupResourceNames: string[] | null
}

export interface GoogleContactsCreateResponse extends ToolResponse {
  output: {
    content: string
    metadata: ContactMetadata
  }
}

export interface GoogleContactsGetResponse extends ToolResponse {
  output: {
    content: string
    metadata: ContactMetadata
  }
}

export interface GoogleContactsListResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      totalItems: number | null
      nextPageToken: string | null
      contacts: ContactMetadata[]
    }
  }
}

export interface GoogleContactsUpdateResponse extends ToolResponse {
  output: {
    content: string
    metadata: ContactMetadata
  }
}

export interface GoogleContactsDeleteResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      resourceName: string
      deleted: boolean
    }
  }
}

export interface GoogleContactsSearchResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      contacts: ContactMetadata[]
    }
  }
}

interface PeopleDate {
  year?: number
  month?: number
  day?: number
}

interface PeoplePerson {
  resourceName?: string
  etag?: string
  names?: Array<{
    displayName?: string
    givenName?: string
    familyName?: string
    middleName?: string
  }>
  emailAddresses?: Array<{ value?: string; type?: string; displayName?: string }>
  phoneNumbers?: Array<{ value?: string; type?: string; canonicalForm?: string }>
  organizations?: Array<{ name?: string; title?: string; department?: string; location?: string }>
  addresses?: Array<{
    formattedValue?: string
    type?: string
    streetAddress?: string
    extendedAddress?: string
    poBox?: string
    city?: string
    region?: string
    postalCode?: string
    country?: string
    countryCode?: string
  }>
  biographies?: Array<{ value?: string }>
  urls?: Array<{ value?: string; type?: string }>
  photos?: Array<{ url?: string }>
  birthdays?: Array<{ date?: PeopleDate; text?: string }>
  events?: Array<{ type?: string; date?: PeopleDate }>
  nicknames?: Array<{ value?: string }>
  relations?: Array<{ person?: string; type?: string }>
  userDefined?: Array<{ key?: string; value?: string }>
  memberships?: Array<{ contactGroupMembership?: { contactGroupResourceName?: string } }>
}

/**
 * Formats a People API `Date` as `YYYY-MM-DD`, or `--MM-DD` when the year is
 * unknown (the API omits `year` for recurring dates such as birthdays).
 */
function formatPeopleDate(date: PeopleDate | undefined): string | null {
  if (!date?.month || !date.day) return null
  const month = String(date.month).padStart(2, '0')
  const day = String(date.day).padStart(2, '0')
  return date.year ? `${String(date.year).padStart(4, '0')}-${month}-${day}` : `--${month}-${day}`
}

/**
 * Parses `YYYY-MM-DD`, `MM-DD`, or `--MM-DD` into a People API `Date`.
 * @throws If the value is not one of those shapes or is not a real calendar day.
 */
export function parsePeopleDate(value: string, paramName: string): PeopleDate {
  const match = value.trim().match(/^(?:(\d{4})-|--)?(\d{1,2})-(\d{1,2})$/)
  const year = match?.[1] ? Number(match[1]) : undefined
  if (year === 0)
    throw new Error(`${paramName} year must be 0001 or later; omit the year for a yearless date`)
  const month = Number(match?.[2])
  const day = Number(match?.[3])
  const probe = new Date(Date.UTC(year ?? 2000, month - 1, day))
  if (!match || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`${paramName} must be YYYY-MM-DD or MM-DD`)
  }
  return year ? { year, month, day } : { month, day }
}

/**
 * Builds the `people/{id}` resource path, accepting either the full resource
 * name or the bare contact id, and rejecting traversal or extra segments.
 */
export function contactResourcePath(resourceName: string): string {
  const id = String(resourceName)
    .trim()
    .replace(/^people\//, '')
  return `people/${safeUrlPathSegment(id, 'resourceName')}`
}

/** Transforms a raw Google People API person object into a ContactMetadata */
export function transformPerson(person: PeoplePerson): ContactMetadata {
  const contactGroupResourceNames =
    person.memberships
      ?.map((m) => m.contactGroupMembership?.contactGroupResourceName)
      .filter((name): name is string => Boolean(name)) ?? null

  return {
    resourceName: person.resourceName ?? '',
    etag: person.etag ?? '',
    displayName: person.names?.[0]?.displayName ?? null,
    givenName: person.names?.[0]?.givenName ?? null,
    familyName: person.names?.[0]?.familyName ?? null,
    middleName: person.names?.[0]?.middleName ?? null,
    emails:
      person.emailAddresses?.map((e) => ({
        value: e.value ?? '',
        type: e.type ?? 'other',
        displayName: e.displayName ?? null,
      })) ?? null,
    phones:
      person.phoneNumbers?.map((p) => ({
        value: p.value ?? '',
        type: p.type ?? 'other',
        canonicalForm: p.canonicalForm ?? null,
      })) ?? null,
    organizations:
      person.organizations?.map((o) => ({
        name: o.name ?? '',
        title: o.title ?? '',
        department: o.department ?? null,
        location: o.location ?? null,
      })) ?? null,
    addresses:
      person.addresses?.map((a) => ({
        formattedValue: a.formattedValue ?? '',
        type: a.type ?? 'other',
        streetAddress: a.streetAddress ?? null,
        extendedAddress: a.extendedAddress ?? null,
        poBox: a.poBox ?? null,
        city: a.city ?? null,
        region: a.region ?? null,
        postalCode: a.postalCode ?? null,
        country: a.country ?? null,
        countryCode: a.countryCode ?? null,
      })) ?? null,
    biographies:
      person.biographies?.map((b) => ({
        value: b.value ?? '',
      })) ?? null,
    urls:
      person.urls?.map((u) => ({
        value: u.value ?? '',
        type: u.type ?? 'other',
      })) ?? null,
    photos:
      person.photos?.map((p) => ({
        url: p.url ?? '',
      })) ?? null,
    birthdays:
      person.birthdays?.map((b) => ({
        date: formatPeopleDate(b.date),
        text: b.text ?? null,
      })) ?? null,
    events:
      person.events?.map((e) => ({
        type: e.type ?? 'other',
        date: formatPeopleDate(e.date),
      })) ?? null,
    nicknames: person.nicknames?.map((n) => ({ value: n.value ?? '' })) ?? null,
    relations:
      person.relations?.map((r) => ({
        person: r.person ?? '',
        type: r.type ?? 'other',
      })) ?? null,
    userDefined:
      person.userDefined?.map((u) => ({
        key: u.key ?? '',
        value: u.value ?? '',
      })) ?? null,
    contactGroupResourceNames,
  }
}
