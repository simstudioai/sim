import type { ToolResponse } from '@/tools/types'

export const PEOPLE_API_BASE = 'https://people.googleapis.com/v1'

export const DEFAULT_PERSON_FIELDS =
  'names,emailAddresses,phoneNumbers,organizations,addresses,biographies,urls,photos,metadata'

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
}

export interface GoogleContactsDeleteParams extends BaseGoogleContactsParams {
  resourceName: string
}

export interface GoogleContactsSearchParams extends BaseGoogleContactsParams {
  query: string
  pageSize?: number
}

export type GoogleContactsToolParams =
  | GoogleContactsCreateParams
  | GoogleContactsGetParams
  | GoogleContactsListParams
  | GoogleContactsUpdateParams
  | GoogleContactsDeleteParams
  | GoogleContactsSearchParams

interface ContactMetadata {
  resourceName: string
  etag: string
  displayName: string | null
  givenName: string | null
  familyName: string | null
  emails: Array<{ value: string; type: string }> | null
  phones: Array<{ value: string; type: string }> | null
  organizations: Array<{ name: string; title: string }> | null
  addresses: Array<{ formattedValue: string; type: string }> | null
  biographies: Array<{ value: string }> | null
  urls: Array<{ value: string; type: string }> | null
  photos: Array<{ url: string }> | null
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

export type GoogleContactsResponse =
  | GoogleContactsCreateResponse
  | GoogleContactsGetResponse
  | GoogleContactsListResponse
  | GoogleContactsUpdateResponse
  | GoogleContactsDeleteResponse
  | GoogleContactsSearchResponse

/** Transforms a raw Google People API person object into a ContactMetadata */
export function transformPerson(person: Record<string, any>): ContactMetadata {
  return {
    resourceName: person.resourceName ?? '',
    etag: person.etag ?? '',
    displayName: person.names?.[0]?.displayName ?? null,
    givenName: person.names?.[0]?.givenName ?? null,
    familyName: person.names?.[0]?.familyName ?? null,
    emails:
      person.emailAddresses?.map((e: Record<string, any>) => ({
        value: e.value ?? '',
        type: e.type ?? 'other',
      })) ?? null,
    phones:
      person.phoneNumbers?.map((p: Record<string, any>) => ({
        value: p.value ?? '',
        type: p.type ?? 'other',
      })) ?? null,
    organizations:
      person.organizations?.map((o: Record<string, any>) => ({
        name: o.name ?? '',
        title: o.title ?? '',
      })) ?? null,
    addresses:
      person.addresses?.map((a: Record<string, any>) => ({
        formattedValue: a.formattedValue ?? '',
        type: a.type ?? 'other',
      })) ?? null,
    biographies:
      person.biographies?.map((b: Record<string, any>) => ({
        value: b.value ?? '',
      })) ?? null,
    urls:
      person.urls?.map((u: Record<string, any>) => ({
        value: u.value ?? '',
        type: u.type ?? 'other',
      })) ?? null,
    photos:
      person.photos?.map((p: Record<string, any>) => ({
        url: p.url ?? '',
      })) ?? null,
  }
}
