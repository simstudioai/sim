import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for LaunchDarkly API responses.
 * Based on LaunchDarkly REST API v2: https://apidocs.launchdarkly.com/
 */

export const FLAG_OUTPUT_PROPERTIES = {
  key: { type: 'string', description: 'The unique key of the feature flag' },
  name: { type: 'string', description: 'The human-readable name of the feature flag' },
  kind: { type: 'string', description: 'The type of flag (boolean or multivariate)' },
  description: { type: 'string', description: 'Description of the feature flag', optional: true },
  temporary: { type: 'boolean', description: 'Whether the flag is temporary' },
  archived: { type: 'boolean', description: 'Whether the flag is archived' },
  deprecated: { type: 'boolean', description: 'Whether the flag is deprecated' },
  creationDate: {
    type: 'number',
    description: 'Unix timestamp in milliseconds when the flag was created',
  },
  tags: {
    type: 'array',
    description: 'Tags applied to the flag',
    items: { type: 'string', description: 'Tag name' },
  },
  variations: {
    type: 'array',
    description: 'The variations for this feature flag',
    items: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'The variation value' },
        name: { type: 'string', description: 'The variation name', optional: true },
        description: { type: 'string', description: 'The variation description', optional: true },
      },
    },
  },
  maintainerId: {
    type: 'string',
    description: 'The ID of the member who maintains this flag',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PROJECT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The project ID' },
  key: { type: 'string', description: 'The unique project key' },
  name: { type: 'string', description: 'The project name' },
  tags: {
    type: 'array',
    description: 'Tags applied to the project',
    items: { type: 'string', description: 'Tag name' },
  },
} as const satisfies Record<string, OutputProperty>

export const ENVIRONMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The environment ID' },
  key: { type: 'string', description: 'The unique environment key' },
  name: { type: 'string', description: 'The environment name' },
  color: { type: 'string', description: 'The color assigned to this environment' },
  apiKey: { type: 'string', description: 'The server-side SDK key for this environment' },
  mobileKey: { type: 'string', description: 'The mobile SDK key for this environment' },
  tags: {
    type: 'array',
    description: 'Tags applied to the environment',
    items: { type: 'string', description: 'Tag name' },
  },
} as const satisfies Record<string, OutputProperty>

export const AUDIT_LOG_ENTRY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The audit log entry ID' },
  date: { type: 'number', description: 'Unix timestamp in milliseconds' },
  kind: { type: 'string', description: 'The type of action performed' },
  name: { type: 'string', description: 'The name of the resource acted on' },
  description: { type: 'string', description: 'Full description of the action', optional: true },
  shortDescription: {
    type: 'string',
    description: 'Short description of the action',
    optional: true,
  },
  memberEmail: {
    type: 'string',
    description: 'Email of the member who performed the action',
    optional: true,
  },
  targetName: { type: 'string', description: 'Name of the target resource', optional: true },
  targetKind: { type: 'string', description: 'Kind of the target resource', optional: true },
} as const satisfies Record<string, OutputProperty>

export const SEGMENT_OUTPUT_PROPERTIES = {
  key: { type: 'string', description: 'The unique segment key' },
  name: { type: 'string', description: 'The segment name' },
  description: { type: 'string', description: 'The segment description', optional: true },
  tags: {
    type: 'array',
    description: 'Tags applied to the segment',
    items: { type: 'string', description: 'Tag name' },
  },
  creationDate: {
    type: 'number',
    description: 'Unix timestamp in milliseconds when the segment was created',
  },
  unbounded: { type: 'boolean', description: 'Whether this is an unbounded (big) segment' },
  included: {
    type: 'array',
    description: 'User keys explicitly included in the segment',
    items: { type: 'string', description: 'User key' },
  },
  excluded: {
    type: 'array',
    description: 'User keys explicitly excluded from the segment',
    items: { type: 'string', description: 'User key' },
  },
} as const satisfies Record<string, OutputProperty>

export const FLAG_STATUS_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'The flag status (new, active, inactive, launched)' },
  lastRequested: {
    type: 'string',
    description: 'Timestamp of the last evaluation',
    optional: true,
  },
  defaultVal: { type: 'string', description: 'The default variation value', optional: true },
} as const satisfies Record<string, OutputProperty>

export const MEMBER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The member ID' },
  email: { type: 'string', description: 'The member email address' },
  firstName: { type: 'string', description: 'The member first name', optional: true },
  lastName: { type: 'string', description: 'The member last name', optional: true },
  role: { type: 'string', description: 'The member role (reader, writer, admin, owner)' },
  lastSeen: { type: 'number', description: 'Unix timestamp of last activity', optional: true },
  creationDate: { type: 'number', description: 'Unix timestamp when the member was created' },
  verified: { type: 'boolean', description: 'Whether the member email is verified' },
} as const satisfies Record<string, OutputProperty>

export interface LaunchDarklyListFlagsParams {
  apiKey: string
  projectKey: string
  environmentKey?: string
  tag?: string
  limit?: number
}

export interface LaunchDarklyGetFlagParams {
  apiKey: string
  projectKey: string
  flagKey: string
  environmentKey?: string
}

export interface LaunchDarklyCreateFlagParams {
  apiKey: string
  projectKey: string
  name: string
  key: string
  description?: string
  tags?: string
  temporary?: boolean
}

export interface LaunchDarklyToggleFlagParams {
  apiKey: string
  projectKey: string
  flagKey: string
  environmentKey: string
  enabled: boolean
}

export interface LaunchDarklyDeleteFlagParams {
  apiKey: string
  projectKey: string
  flagKey: string
}

export interface LaunchDarklyListProjectsParams {
  apiKey: string
  limit?: number
}

export interface LaunchDarklyListEnvironmentsParams {
  apiKey: string
  projectKey: string
  limit?: number
}

interface FlagItem {
  key: string
  name: string
  kind: string
  description: string | null
  temporary: boolean
  archived: boolean
  deprecated: boolean
  creationDate: number
  tags: string[]
  variations: Array<{ value: unknown; name?: string; description?: string }>
  maintainerId: string | null
}

interface ProjectItem {
  id: string
  key: string
  name: string
  tags: string[]
}

interface EnvironmentItem {
  id: string
  key: string
  name: string
  color: string
  apiKey: string
  mobileKey: string
  tags: string[]
}

export interface LaunchDarklyListFlagsResponse extends ToolResponse {
  output: {
    flags: FlagItem[]
    totalCount: number
  }
}

export interface LaunchDarklyGetFlagResponse extends ToolResponse {
  output: FlagItem & {
    on: boolean | null
  }
}

export interface LaunchDarklyCreateFlagResponse extends ToolResponse {
  output: FlagItem
}

export interface LaunchDarklyToggleFlagResponse extends ToolResponse {
  output: FlagItem & {
    on: boolean | null
  }
}

export interface LaunchDarklyDeleteFlagResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

export interface LaunchDarklyListProjectsResponse extends ToolResponse {
  output: {
    projects: ProjectItem[]
    totalCount: number
  }
}

export interface LaunchDarklyListEnvironmentsResponse extends ToolResponse {
  output: {
    environments: EnvironmentItem[]
    totalCount: number
  }
}

export interface LaunchDarklyUpdateFlagParams {
  apiKey: string
  projectKey: string
  flagKey: string
  updateName?: string
  updateDescription?: string
  addTags?: string
  removeTags?: string
  archive?: boolean
  comment?: string
}

export interface LaunchDarklyUpdateFlagResponse extends ToolResponse {
  output: FlagItem
}

export interface LaunchDarklyGetAuditLogParams {
  apiKey: string
  limit?: number
  spec?: string
}

interface AuditLogEntry {
  id: string
  date: number | null
  kind: string | null
  name: string | null
  description: string | null
  shortDescription: string | null
  memberEmail: string | null
  targetName: string | null
  targetKind: string | null
}

export interface LaunchDarklyGetAuditLogResponse extends ToolResponse {
  output: {
    entries: AuditLogEntry[]
    totalCount: number
  }
}

export interface LaunchDarklyListSegmentsParams {
  apiKey: string
  projectKey: string
  environmentKey: string
  limit?: number
}

interface SegmentItem {
  key: string
  name: string
  description: string | null
  tags: string[]
  creationDate: number | null
  unbounded: boolean
  included: string[]
  excluded: string[]
}

export interface LaunchDarklyListSegmentsResponse extends ToolResponse {
  output: {
    segments: SegmentItem[]
    totalCount: number
  }
}

export interface LaunchDarklyGetFlagStatusParams {
  apiKey: string
  projectKey: string
  flagKey: string
  environmentKey: string
}

export interface LaunchDarklyGetFlagStatusResponse extends ToolResponse {
  output: {
    name: string
    lastRequested: string | null
    defaultVal: string | null
  }
}

export interface LaunchDarklyListMembersParams {
  apiKey: string
  limit?: number
}

interface MemberItem {
  id: string
  email: string | null
  firstName: string | null
  lastName: string | null
  role: string | null
  lastSeen: number | null
  creationDate: number | null
  verified: boolean
}

export interface LaunchDarklyListMembersResponse extends ToolResponse {
  output: {
    members: MemberItem[]
    totalCount: number
  }
}
