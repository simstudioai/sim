import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface HarmonicContact {
  personUrn: string | null
  personId: number | null
  fullName: string | null
  firstName: string | null
  lastName: string | null
  headline: string | null
  currentTitles: string[] | null
  currentCompanyNames: string[] | null
  currentCompanyUrns: string[] | null
  primaryEmail: string | null
  emails: string[] | null
  phoneNumbers: string[] | null
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
  savedSearchId: number
  savedSearchUrn: string
  name: string
  isPrivate: boolean | null
  savedSearchType: 'PERSONS'
  userSavedSearchType: string
  creatorUrn: string
  createdAt: string
  updatedAt: string
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

export interface HarmonicEnrichmentOutput {
  entity_urn?: unknown
  status?: unknown
  message?: unknown
  enriched_entity_urn?: unknown
}

export interface HarmonicEnrichmentStatus {
  enrichmentUrn: string | null
  status: string | null
  message: string | null
  enrichedEntityUrn: string | null
}

export interface HarmonicDroppedIdentifier {
  submittedIdentifier: string
  reason: string
}

export interface HarmonicEmailJobItem {
  personUrn: string
  status: string
}

export interface HarmonicEmailJobCounts {
  totalProcessed: number
  totalSucceeded: number
  totalFailed: number
  totalSkipped: number
  totalNotFound: number
}

interface HarmonicAuthParams {
  accessToken: string
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
  personIds?: Array<number | string> | string
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

export interface HarmonicEnrichPersonParams extends HarmonicAuthParams {
  linkedinUrl?: string
  email?: string
}

export interface HarmonicGetPersonParams extends HarmonicAuthParams {
  personId: string
  companyContextUrns?: string[] | string
}

export interface HarmonicGetCompanyEmployeesParams extends HarmonicAuthParams {
  companyId: string
  employeeGroupType?: string
  employeeStatus?: string
  userConnectionStatus?: string
  size?: number | string
  cursor?: string
}

export interface HarmonicGetPeopleSavedSearchNetNewResultsParams extends HarmonicAuthParams {
  savedSearchId: string
  size?: number | string
  cursor?: string
  newResultsSince?: string
}

export interface HarmonicClearPeopleSavedSearchNetNewResultsParams extends HarmonicAuthParams {
  savedSearchId: string
  personUrns?: string[] | string
  clearScope?: 'selected' | 'all'
}

export interface HarmonicSubmitEmailEnrichmentJobParams extends HarmonicAuthParams {
  personUrns?: string[] | string
  personLinkedinUrls?: string[] | string
}

export interface HarmonicGetEmailEnrichmentJobParams extends HarmonicAuthParams {
  jobId: string
}

export type HarmonicGetEmailEnrichmentUsageParams = HarmonicAuthParams

export interface HarmonicGetEnrichmentStatusParams extends HarmonicAuthParams {
  enrichmentUrns?: string[] | string
}

export interface HarmonicEnrichPersonResponse extends ToolResponse {
  output: {
    contact: HarmonicContact | null
    enrichmentUrn: string | null
    mergedPersonUrn: string | null
    requestedEntityUrn: string | null
    found: boolean
    enrichmentQueued: boolean
  }
}

export interface HarmonicGetPersonResponse extends ToolResponse {
  output: {
    contact: HarmonicContact | null
    found: boolean
  }
}

export interface HarmonicGetCompanyEmployeesResponse extends ToolResponse {
  output: {
    personUrns: string[]
    totalCount: number | null
    pageInfo: HarmonicPageInfo | null
  }
}

export interface HarmonicGetPeopleSavedSearchNetNewResultsResponse extends ToolResponse {
  output: {
    contacts: HarmonicContact[]
    personUrns: string[]
    cursor: string | null
    pageInfo: HarmonicPageInfo | null
  }
}

export interface HarmonicClearPeopleSavedSearchNetNewResultsResponse extends ToolResponse {
  output: {
    cleared: boolean
    clearedPersonUrns: string[] | null
  }
}

export interface HarmonicSubmitEmailEnrichmentJobResponse extends ToolResponse {
  output: {
    jobId: string
    status: string
    acceptedCount: number
    monthlyRemaining: number
    createdAt: string
    dropped: HarmonicDroppedIdentifier[]
  }
}

export interface HarmonicGetEmailEnrichmentJobResponse extends ToolResponse {
  output: {
    jobId: string
    status: string
    isTerminal: boolean
    counts: HarmonicEmailJobCounts
    results: HarmonicEmailJobItem[] | null
    succeededPersonUrns: string[]
    createdAt: string
    completedAt: string | null
  }
}

export interface HarmonicGetEmailEnrichmentUsageResponse extends ToolResponse {
  output: {
    monthlyUsage: number
    monthlyLimit: number
    monthlyRemaining: number
  }
}

export interface HarmonicGetEnrichmentStatusResponse extends ToolResponse {
  output: {
    enrichments: HarmonicEnrichmentStatus[]
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
    nullable: true,
    description: 'Current job titles',
    items: { type: 'string', description: 'Job title' },
  },
  currentCompanyNames: {
    type: 'array',
    nullable: true,
    description: 'Current company names',
    items: { type: 'string', description: 'Company name' },
  },
  currentCompanyUrns: {
    type: 'array',
    nullable: true,
    description: 'Current Harmonic company URNs',
    items: { type: 'string', description: 'Company URN' },
  },
  primaryEmail: { type: 'string', nullable: true, description: 'Primary known email address' },
  emails: {
    type: 'array',
    nullable: true,
    description: 'Known email addresses',
    items: { type: 'string', description: 'Email address' },
  },
  phoneNumbers: {
    type: 'array',
    nullable: true,
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
  savedSearchId: { type: 'number', description: 'Saved search ID' },
  savedSearchUrn: { type: 'string', description: 'Saved search URN' },
  name: { type: 'string', description: 'Saved search name' },
  isPrivate: { type: 'boolean', nullable: true, description: 'Whether the search is private' },
  savedSearchType: { type: 'string', description: 'Saved search entity type (PERSONS)' },
  userSavedSearchType: {
    type: 'string',
    description: 'User-facing saved search type',
  },
  creatorUrn: { type: 'string', description: 'Creator user URN' },
  createdAt: { type: 'string', description: 'Creation timestamp' },
  updatedAt: { type: 'string', description: 'Last update timestamp' },
} as const satisfies Record<string, OutputProperty>

export const HARMONIC_DROPPED_IDENTIFIER_OUTPUT_PROPERTIES = {
  submittedIdentifier: { type: 'string', description: 'Identifier submitted to Harmonic' },
  reason: {
    type: 'string',
    description:
      'Why Harmonic dropped it (NOT_FOUND, INVALID_URL, ALREADY_HAS_EMAIL, RECENTLY_ATTEMPTED)',
  },
} as const satisfies Record<string, OutputProperty>

export const HARMONIC_EMAIL_JOB_ITEM_OUTPUT_PROPERTIES = {
  personUrn: { type: 'string', description: 'Harmonic person URN' },
  status: {
    type: 'string',
    description: 'Per-person job status (PENDING, SUCCESS, NOT_FOUND, FAILED, SKIPPED)',
  },
} as const satisfies Record<string, OutputProperty>

export const HARMONIC_EMAIL_JOB_COUNTS_OUTPUT_PROPERTIES = {
  totalProcessed: { type: 'number', description: 'People processed' },
  totalSucceeded: { type: 'number', description: 'People with an email found' },
  totalFailed: { type: 'number', description: 'People whose enrichment failed' },
  totalSkipped: { type: 'number', description: 'People skipped' },
  totalNotFound: { type: 'number', description: 'People Harmonic could not resolve' },
} as const satisfies Record<string, OutputProperty>

export const HARMONIC_ENRICHMENT_STATUS_OUTPUT_PROPERTIES = {
  enrichmentUrn: { type: 'string', nullable: true, description: 'Harmonic enrichment URN' },
  status: {
    type: 'string',
    nullable: true,
    description:
      'Enrichment job status (QUEUED, IN_PROGRESS, COMPLETE, FAILED, NOT_FOUND, EXPERIENCES_HIDDEN)',
  },
  message: { type: 'string', nullable: true, description: 'Provider status message' },
  enrichedEntityUrn: {
    type: 'string',
    nullable: true,
    description: 'Resulting company or person URN once enrichment completes',
  },
} as const satisfies Record<string, OutputProperty>
