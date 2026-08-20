import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface HarmonicContact {
  personUrn: string | null
  personId: number | null
  fullName: string | null
  firstName: string | null
  lastName: string | null
  headline: string | null
  currentTitles: string[]
  currentCompanyNames: string[]
  currentCompanyUrns: string[]
  primaryEmail: string | null
  emails: string[]
  phoneNumbers: string[]
  linkedinUrl: string | null
  formattedLocation: string | null
  city: string | null
  state: string | null
  country: string | null
  profilePictureUrl: string | null
  summary: string | null
  isRedacted: boolean | null
}

export interface HarmonicPageInfo {
  nextCursor: string | null
  currentCursor: string | null
  hasNext: boolean
}

export interface HarmonicSavedSearch {
  savedSearchId: number | null
  savedSearchUrn: string | null
  name: string | null
  isPrivate: boolean | null
  savedSearchType: string | null
  userSavedSearchType: string | null
  creatorUrn: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface HarmonicContactMetadata {
  emails?: unknown
  phone_numbers?: unknown
  exec_emails?: unknown
  primary_email?: unknown
}

export interface HarmonicLocationMetadata {
  address_formatted?: unknown
  location?: unknown
  city?: unknown
  state?: unknown
  country?: unknown
}

export interface HarmonicSocialMetadata {
  url?: unknown
}

export interface HarmonicExperienceMetadata {
  title?: unknown
  is_current_position?: unknown
  company?: unknown
  company_name?: unknown
}

/** The documented subset of PersonOutput used by the contact projection. */
export interface HarmonicPersonOutput {
  entity_urn?: unknown
  id?: unknown
  full_name?: unknown
  first_name?: unknown
  last_name?: unknown
  profile_picture_url?: unknown
  contact?: HarmonicContactMetadata | null
  location?: HarmonicLocationMetadata | null
  socials?: Record<string, HarmonicSocialMetadata> | null
  experience?: HarmonicExperienceMetadata[] | null
  linkedin_headline?: unknown
  current_company_urns?: unknown
  is_redacted?: unknown
}

export interface HarmonicScoutPerson {
  name?: unknown
  linkedin_url?: unknown
  person_urn?: unknown
  title?: unknown
  company?: unknown
  location?: unknown
  email?: unknown
  one_liner?: unknown
}

export interface HarmonicPaginationMetadata {
  next?: unknown
  current?: unknown
  has_next?: unknown
}

export interface HarmonicSavedSearchOutput {
  id?: unknown
  entity_urn?: unknown
  name?: unknown
  is_private?: unknown
  type?: unknown
  user_saved_search_type?: unknown
  creator?: unknown
  created_at?: unknown
  updated_at?: unknown
}

interface HarmonicAuthParams {
  apiKey: string
}

export interface HarmonicSearchPeopleScoutParams extends HarmonicAuthParams {
  query: string
}

export type HarmonicListPeopleSavedSearchesParams = HarmonicAuthParams

export interface HarmonicGetPeopleSavedSearchResultsParams extends HarmonicAuthParams {
  savedSearchId: string
  size?: number | string
  cursor?: string
}

export interface HarmonicBatchGetPeopleParams extends HarmonicAuthParams {
  personIds?: number[] | string
  personUrns?: string[] | string
}

export interface HarmonicSearchPeopleScoutResponse extends ToolResponse {
  output: {
    contacts: HarmonicContact[]
    taskId: string
    status: string
    count: number
  }
}

export interface HarmonicListPeopleSavedSearchesResponse extends ToolResponse {
  output: {
    savedSearches: HarmonicSavedSearch[]
    count: number
  }
}

export interface HarmonicGetPeopleSavedSearchResultsResponse extends ToolResponse {
  output: {
    contacts: HarmonicContact[]
    personUrns: string[]
    totalCount: number | null
    pageInfo: HarmonicPageInfo | null
  }
}

export interface HarmonicBatchGetPeopleResponse extends ToolResponse {
  output: {
    contacts: HarmonicContact[]
    count: number
  }
}

export const HARMONIC_CONTACT_OUTPUT_PROPERTIES = {
  personUrn: { type: 'string', nullable: true, description: 'Harmonic person URN' },
  personId: { type: 'number', nullable: true, description: 'Numeric Harmonic person ID' },
  fullName: { type: 'string', nullable: true, description: 'Full name' },
  firstName: { type: 'string', nullable: true, description: 'First name' },
  lastName: { type: 'string', nullable: true, description: 'Last name' },
  headline: { type: 'string', nullable: true, description: 'LinkedIn headline or current title' },
  currentTitles: {
    type: 'array',
    description: 'Current job titles',
    items: { type: 'string', description: 'Job title' },
  },
  currentCompanyNames: {
    type: 'array',
    description: 'Current company names',
    items: { type: 'string', description: 'Company name' },
  },
  currentCompanyUrns: {
    type: 'array',
    description: 'Current Harmonic company URNs',
    items: { type: 'string', description: 'Company URN' },
  },
  primaryEmail: { type: 'string', nullable: true, description: 'Primary known email address' },
  emails: {
    type: 'array',
    description: 'Known email addresses',
    items: { type: 'string', description: 'Email address' },
  },
  phoneNumbers: {
    type: 'array',
    description: 'Known phone numbers',
    items: { type: 'string', description: 'Phone number' },
  },
  linkedinUrl: { type: 'string', nullable: true, description: 'LinkedIn profile URL' },
  formattedLocation: { type: 'string', nullable: true, description: 'Formatted location' },
  city: { type: 'string', nullable: true, description: 'City' },
  state: { type: 'string', nullable: true, description: 'State or region' },
  country: { type: 'string', nullable: true, description: 'Country' },
  profilePictureUrl: { type: 'string', nullable: true, description: 'Profile picture URL' },
  summary: { type: 'string', nullable: true, description: 'Scout-generated contact summary' },
  isRedacted: {
    type: 'boolean',
    nullable: true,
    description: 'Whether Harmonic marks the person record as redacted',
  },
} as const satisfies Record<string, OutputProperty>

export const HARMONIC_PAGE_INFO_OUTPUT_PROPERTIES = {
  nextCursor: { type: 'string', nullable: true, description: 'Cursor for the next page' },
  currentCursor: { type: 'string', nullable: true, description: 'Cursor for the current page' },
  hasNext: { type: 'boolean', description: 'Whether another page is available' },
} as const satisfies Record<string, OutputProperty>

export const HARMONIC_SAVED_SEARCH_OUTPUT_PROPERTIES = {
  savedSearchId: { type: 'number', nullable: true, description: 'Saved search ID' },
  savedSearchUrn: { type: 'string', nullable: true, description: 'Saved search URN' },
  name: { type: 'string', nullable: true, description: 'Saved search name' },
  isPrivate: { type: 'boolean', nullable: true, description: 'Whether the search is private' },
  savedSearchType: { type: 'string', nullable: true, description: 'Saved search entity type' },
  userSavedSearchType: {
    type: 'string',
    nullable: true,
    description: 'User-facing saved search type',
  },
  creatorUrn: { type: 'string', nullable: true, description: 'Creator user URN' },
  createdAt: { type: 'string', nullable: true, description: 'Creation timestamp' },
  updatedAt: { type: 'string', nullable: true, description: 'Last update timestamp' },
} as const satisfies Record<string, OutputProperty>
