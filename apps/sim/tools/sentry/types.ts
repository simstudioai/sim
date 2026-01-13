import type { ToolResponse } from '@/tools/types'

/**
 * Base parameter interface shared across all Sentry tools
 */
export interface SentryBaseParams {
  apiKey: string
  organizationSlug: string
}

/**
 * Sentry issue representation
 */
export interface SentryIssue {
  id: string
  shortId: string
  title: string
  culprit: string
  permalink: string
  logger: string | null
  level: string
  status: string
  statusDetails: Record<string, any>
  isPublic: boolean
  platform: string
  project: {
    id: string
    name: string
    slug: string
    platform: string
  }
  type: string
  metadata: {
    type: string | null
    value: string | null
    function: string | null
  }
  numComments: number
  assignedTo: {
    id: string
    name: string
    email: string
  } | null
  isBookmarked: boolean
  isSubscribed: boolean
  subscriptionDetails: Record<string, any> | null
  hasSeen: boolean
  annotations: string[]
  isUnhandled: boolean
  count: string
  userCount: number
  firstSeen: string
  lastSeen: string
  stats: Record<string, any>
}

export interface SentryListIssuesParams extends SentryBaseParams {
  projectSlug?: string
  query?: string
  statsPeriod?: string
  cursor?: string
  limit?: number
  status?: string
  sort?: string
}

export interface SentryListIssuesResponse extends ToolResponse {
  output: {
    issues: SentryIssue[]
    metadata: {
      nextCursor?: string
      hasMore: boolean
    }
  }
}

export interface SentryGetIssueParams extends SentryBaseParams {
  issueId: string
}

export interface SentryGetIssueResponse extends ToolResponse {
  output: {
    issue: SentryIssue
  }
}

export interface SentryUpdateIssueParams extends SentryBaseParams {
  issueId: string
  status?: string
  assignedTo?: string
  isBookmarked?: boolean
  isSubscribed?: boolean
  isPublic?: boolean
}

export interface SentryUpdateIssueResponse extends ToolResponse {
  output: {
    issue: SentryIssue
  }
}

/**
 * Sentry project representation
 */
export interface SentryProject {
  id: string
  slug: string
  name: string
  platform: string
  dateCreated: string
  isBookmarked: boolean
  isMember: boolean
  features: string[]
  firstEvent: string | null
  firstTransactionEvent: boolean
  access: string[]
  hasAccess: boolean
  hasMinifiedStackTrace: boolean
  hasMonitors: boolean
  hasProfiles: boolean
  hasReplays: boolean
  hasSessions: boolean
  isInternal: boolean
  organization: {
    id: string
    slug: string
    name: string
  }
  team: {
    id: string
    name: string
    slug: string
  }
  teams: Array<{
    id: string
    name: string
    slug: string
  }>
  status: string
  color: string
  isPublic: boolean
}

export interface SentryListProjectsParams extends SentryBaseParams {
  cursor?: string
  limit?: number
}

export interface SentryListProjectsResponse extends ToolResponse {
  output: {
    projects: SentryProject[]
    metadata: {
      nextCursor?: string
      hasMore: boolean
    }
  }
}

export interface SentryGetProjectParams extends SentryBaseParams {
  projectSlug: string
}

export interface SentryGetProjectResponse extends ToolResponse {
  output: {
    project: SentryProject
  }
}

export interface SentryCreateProjectParams extends SentryBaseParams {
  name: string
  slug?: string
  platform?: string
  teamSlug: string
  defaultRules?: boolean
}

export interface SentryCreateProjectResponse extends ToolResponse {
  output: {
    project: SentryProject
  }
}

export interface SentryUpdateProjectParams extends SentryBaseParams {
  projectSlug: string
  name?: string
  slug?: string
  platform?: string
  isBookmarked?: boolean
  digestsMinDelay?: number
  digestsMaxDelay?: number
}

export interface SentryUpdateProjectResponse extends ToolResponse {
  output: {
    project: SentryProject
  }
}

/**
 * Sentry event representation
 */
export interface SentryEvent {
  id: string
  eventID: string
  projectID: string
  groupID: string
  message: string
  title: string
  location: string | null
  culprit: string
  dateCreated: string
  dateReceived: string
  user: {
    id: string
    email: string
    username: string
    ipAddress: string
    name: string
  } | null
  tags: Array<{
    key: string
    value: string
  }>
  contexts: Record<string, any>
  platform: string
  type: string
  metadata: {
    type: string | null
    value: string | null
    function: string | null
  }
  entries: Array<{
    type: string
    data: Record<string, any>
  }>
  errors: Array<{
    type: string
    message: string
    data: Record<string, any>
  }>
  dist: string | null
  fingerprints: string[]
  sdk: {
    name: string
    version: string
  } | null
}

export interface SentryListEventsParams extends SentryBaseParams {
  projectSlug: string
  issueId?: string
  query?: string
  cursor?: string
  limit?: number
  statsPeriod?: string
}

export interface SentryListEventsResponse extends ToolResponse {
  output: {
    events: SentryEvent[]
    metadata: {
      nextCursor?: string
      hasMore: boolean
    }
  }
}

export interface SentryGetEventParams extends SentryBaseParams {
  projectSlug: string
  eventId: string
}

export interface SentryGetEventResponse extends ToolResponse {
  output: {
    event: SentryEvent
  }
}

/**
 * Sentry release representation
 */
export interface SentryRelease {
  id: string
  version: string
  shortVersion: string
  ref: string | null
  url: string | null
  dateReleased: string | null
  dateCreated: string
  dateStarted: string | null
  data: Record<string, any>
  newGroups: number
  owner: {
    id: string
    name: string
    email: string
  } | null
  commitCount: number
  lastCommit: {
    id: string
    message: string
    dateCreated: string
  } | null
  deployCount: number
  lastDeploy: {
    id: string
    environment: string
    dateStarted: string
    dateFinished: string
  } | null
  authors: Array<{
    id: string
    name: string
    email: string
  }>
  projects: Array<{
    id: string
    name: string
    slug: string
    platform: string
  }>
  firstEvent: string | null
  lastEvent: string | null
  versionInfo: {
    buildHash: string | null
    version: {
      raw: string
    }
    package: string | null
  }
}

export interface SentryListReleasesParams extends SentryBaseParams {
  projectSlug?: string
  query?: string
  cursor?: string
  limit?: number
}

export interface SentryListReleasesResponse extends ToolResponse {
  output: {
    releases: SentryRelease[]
    metadata: {
      nextCursor?: string
      hasMore: boolean
    }
  }
}

export interface SentryCreateReleaseParams extends SentryBaseParams {
  version: string
  ref?: string
  url?: string
  projects: string
  dateReleased?: string
  commits?: string
}

export interface SentryCreateReleaseResponse extends ToolResponse {
  output: {
    release: SentryRelease
  }
}

export interface SentryCreateDeployParams extends SentryBaseParams {
  version: string
  environment: string
  name?: string
  url?: string
  dateStarted?: string
  dateFinished?: string
}

export interface SentryCreateDeployResponse extends ToolResponse {
  output: {
    deploy: {
      id: string
      environment: string
      name: string | null
      url: string | null
      dateStarted: string
      dateFinished: string | null
    }
  }
}

/**
 * Union response type for all Sentry operations
 */
export type SentryResponse =
  | SentryListIssuesResponse
  | SentryGetIssueResponse
  | SentryUpdateIssueResponse
  | SentryListProjectsResponse
  | SentryGetProjectResponse
  | SentryCreateProjectResponse
  | SentryUpdateProjectResponse
  | SentryListEventsResponse
  | SentryGetEventResponse
  | SentryListReleasesResponse
  | SentryCreateReleaseResponse
  | SentryCreateDeployResponse
