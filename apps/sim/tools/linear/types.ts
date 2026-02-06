import type { UserFile } from '@/executor/types'
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Linear API responses.
 * These are reusable across all Linear tools to ensure consistency.
 * Fields based on Linear GraphQL API schema.
 */

/**
 * Output definition for nested state objects in issue responses
 */
export const STATE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'State ID' },
  name: { type: 'string', description: 'State name (e.g., "Todo", "In Progress")' },
  type: { type: 'string', description: 'State type (unstarted, started, completed, canceled)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete state object output definition
 */
export const STATE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Workflow state/status',
  properties: STATE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for nested assignee/user objects
 */
export const USER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'User ID' },
  name: { type: 'string', description: 'User name' },
  email: { type: 'string', description: 'User email' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete user object output definition
 */
export const USER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'User object',
  properties: USER_OUTPUT_PROPERTIES,
}

/**
 * Output definition for full user objects (list users, get viewer)
 */
export const USER_FULL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'User ID' },
  name: { type: 'string', description: 'User name' },
  email: { type: 'string', description: 'User email' },
  displayName: { type: 'string', description: 'Display name' },
  active: { type: 'boolean', description: 'Whether user is active' },
  admin: { type: 'boolean', description: 'Whether user is admin' },
  avatarUrl: { type: 'string', description: 'Avatar URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for nested team objects
 */
export const TEAM_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Team ID' },
  name: { type: 'string', description: 'Team name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete team object output definition
 */
export const TEAM_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Team object',
  properties: TEAM_OUTPUT_PROPERTIES,
}

/**
 * Output definition for full team objects (list teams)
 */
export const TEAM_FULL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Team ID' },
  name: { type: 'string', description: 'Team name' },
  key: { type: 'string', description: 'Team key (used in issue identifiers)' },
  description: { type: 'string', description: 'Team description' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for nested label objects
 */
export const LABEL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Label ID' },
  name: { type: 'string', description: 'Label name' },
  color: { type: 'string', description: 'Label color (hex)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete labels array output definition
 */
export const LABELS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Issue labels',
  items: {
    type: 'object',
    properties: LABEL_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for full label objects (list labels, create label)
 */
export const LABEL_FULL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Label ID' },
  name: { type: 'string', description: 'Label name' },
  color: { type: 'string', description: 'Label color (hex)' },
  description: { type: 'string', description: 'Label description' },
  isGroup: { type: 'boolean', description: 'Whether this label is a group' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  archivedAt: { type: 'string', description: 'Archive timestamp (ISO 8601)' },
  team: TEAM_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for nested cycle objects
 */
export const CYCLE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Cycle ID' },
  number: { type: 'number', description: 'Cycle number' },
  name: { type: 'string', description: 'Cycle name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete cycle object output definition
 */
export const CYCLE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Cycle/sprint object',
  properties: CYCLE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for full cycle objects (list cycles, get cycle)
 */
export const CYCLE_FULL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Cycle ID' },
  number: { type: 'number', description: 'Cycle number' },
  name: { type: 'string', description: 'Cycle name' },
  startsAt: { type: 'string', description: 'Start date (ISO 8601)' },
  endsAt: { type: 'string', description: 'End date (ISO 8601)' },
  completedAt: { type: 'string', description: 'Completion date (ISO 8601)' },
  progress: { type: 'number', description: 'Progress percentage (0-1)' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  team: TEAM_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for nested project objects
 */
export const PROJECT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Project ID' },
  name: { type: 'string', description: 'Project name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete project object output definition
 */
export const PROJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Project object',
  properties: PROJECT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for full project objects (list projects, get project, create project)
 */
export const PROJECT_FULL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Project ID' },
  name: { type: 'string', description: 'Project name' },
  description: { type: 'string', description: 'Project description' },
  state: {
    type: 'string',
    description: 'Project state (planned, started, paused, completed, canceled)',
  },
  priority: { type: 'number', description: 'Project priority (0-4)' },
  startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
  targetDate: { type: 'string', description: 'Target date (YYYY-MM-DD)' },
  url: { type: 'string', description: 'Project URL' },
  lead: USER_OUTPUT,
  teams: {
    type: 'array',
    description: 'Associated teams',
    items: {
      type: 'object',
      properties: TEAM_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for nested issue objects (minimal)
 */
export const ISSUE_MINIMAL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Issue ID' },
  title: { type: 'string', description: 'Issue title' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete issue minimal object output definition
 */
export const ISSUE_MINIMAL_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Issue object',
  properties: ISSUE_MINIMAL_OUTPUT_PROPERTIES,
}

/**
 * Output definition for full issue objects (get issue, create issue, update issue)
 */
export const ISSUE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Issue ID' },
  title: { type: 'string', description: 'Issue title' },
  description: { type: 'string', description: 'Issue description' },
  priority: {
    type: 'number',
    description: 'Priority (0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low)',
  },
  estimate: { type: 'number', description: 'Estimate in points' },
  url: { type: 'string', description: 'Issue URL' },
  dueDate: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  completedAt: { type: 'string', description: 'Completion timestamp (ISO 8601)' },
  canceledAt: { type: 'string', description: 'Cancellation timestamp (ISO 8601)' },
  archivedAt: { type: 'string', description: 'Archive timestamp (ISO 8601)' },
  state: STATE_OUTPUT,
  assignee: USER_OUTPUT,
  teamId: { type: 'string', description: 'Team ID' },
  projectId: { type: 'string', description: 'Project ID' },
  labels: LABELS_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for issue objects with cycle/parent info (create issue response)
 */
export const ISSUE_EXTENDED_OUTPUT_PROPERTIES = {
  ...ISSUE_OUTPUT_PROPERTIES,
  cycleId: { type: 'string', description: 'Cycle ID' },
  cycleNumber: { type: 'number', description: 'Cycle number' },
  cycleName: { type: 'string', description: 'Cycle name' },
  parentId: { type: 'string', description: 'Parent issue ID' },
  parentTitle: { type: 'string', description: 'Parent issue title' },
  projectMilestoneId: { type: 'string', description: 'Project milestone ID' },
  projectMilestoneName: { type: 'string', description: 'Project milestone name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for comment objects
 */
export const COMMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Comment ID' },
  body: { type: 'string', description: 'Comment text (Markdown)' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  user: USER_OUTPUT,
  issue: ISSUE_MINIMAL_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for attachment objects
 */
export const ATTACHMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Attachment ID' },
  title: { type: 'string', description: 'Attachment title' },
  subtitle: { type: 'string', description: 'Attachment subtitle' },
  url: { type: 'string', description: 'Attachment URL' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for workflow state objects (full)
 */
export const WORKFLOW_STATE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'State ID' },
  name: { type: 'string', description: 'State name (e.g., "Todo", "In Progress")' },
  description: { type: 'string', description: 'State description' },
  type: {
    type: 'string',
    description: 'State type (triage, backlog, unstarted, started, completed, canceled)',
  },
  color: { type: 'string', description: 'State color (hex)' },
  position: { type: 'number', description: 'State position in workflow' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  archivedAt: { type: 'string', description: 'Archive timestamp (ISO 8601)' },
  team: TEAM_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for issue relation objects
 */
export const ISSUE_RELATION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Relation ID' },
  type: { type: 'string', description: 'Relation type (blocks, duplicate, related)' },
  issue: ISSUE_MINIMAL_OUTPUT,
  relatedIssue: ISSUE_MINIMAL_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for favorite objects
 */
export const FAVORITE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Favorite ID' },
  type: { type: 'string', description: 'Favorite type (issue, project, cycle)' },
  issue: ISSUE_MINIMAL_OUTPUT,
  project: PROJECT_OUTPUT,
  cycle: CYCLE_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for project update objects
 */
export const PROJECT_UPDATE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Project update ID' },
  body: { type: 'string', description: 'Update body (Markdown)' },
  health: { type: 'string', description: 'Project health (onTrack, atRisk, offTrack)' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  user: USER_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for notification objects
 */
export const NOTIFICATION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Notification ID' },
  type: { type: 'string', description: 'Notification type' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  readAt: { type: 'string', description: 'Read timestamp (ISO 8601)' },
  issue: ISSUE_MINIMAL_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for customer objects
 */
export const CUSTOMER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Customer ID' },
  name: { type: 'string', description: 'Customer name' },
  domains: {
    type: 'array',
    description: 'Associated domains',
    items: { type: 'string', description: 'Domain' },
  },
  externalIds: {
    type: 'array',
    description: 'External IDs from other systems',
    items: { type: 'string', description: 'External ID' },
  },
  logoUrl: { type: 'string', description: 'Logo URL' },
  slugId: { type: 'string', description: 'Unique URL slug' },
  approximateNeedCount: { type: 'number', description: 'Number of customer needs' },
  revenue: { type: 'number', description: 'Annual revenue' },
  size: { type: 'number', description: 'Organization size' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  archivedAt: { type: 'string', description: 'Archive timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for customer need/request objects
 */
export const CUSTOMER_NEED_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Customer need ID' },
  body: { type: 'string', description: 'Need body/description' },
  priority: { type: 'number', description: 'Priority (0-4)' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  archivedAt: { type: 'string', description: 'Archive timestamp (ISO 8601)' },
  customer: {
    type: 'object',
    description: 'Associated customer',
    properties: {
      id: { type: 'string', description: 'Customer ID' },
      name: { type: 'string', description: 'Customer name' },
    },
  },
  issue: ISSUE_MINIMAL_OUTPUT,
  project: PROJECT_OUTPUT,
  creator: USER_OUTPUT,
  url: { type: 'string', description: 'Customer need URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for customer status objects
 */
export const CUSTOMER_STATUS_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Customer status ID' },
  name: { type: 'string', description: 'Status name' },
  description: { type: 'string', description: 'Status description' },
  color: { type: 'string', description: 'Status color (hex)' },
  position: { type: 'number', description: 'Position in list' },
  type: { type: 'string', description: 'Status type (active, inactive)' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last updated timestamp (ISO 8601)' },
  archivedAt: { type: 'string', description: 'Archive timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for customer tier objects
 */
export const CUSTOMER_TIER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Customer tier ID' },
  name: { type: 'string', description: 'Tier name' },
  displayName: { type: 'string', description: 'Display name' },
  description: { type: 'string', description: 'Tier description' },
  color: { type: 'string', description: 'Tier color (hex)' },
  position: { type: 'number', description: 'Position in list' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  archivedAt: { type: 'string', description: 'Archive timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for project label objects
 */
export const PROJECT_LABEL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Project label ID' },
  name: { type: 'string', description: 'Label name' },
  description: { type: 'string', description: 'Label description' },
  color: { type: 'string', description: 'Label color (hex)' },
  isGroup: { type: 'boolean', description: 'Whether this label is a group' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  archivedAt: { type: 'string', description: 'Archive timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for project milestone objects
 */
export const PROJECT_MILESTONE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Project milestone ID' },
  name: { type: 'string', description: 'Milestone name' },
  description: { type: 'string', description: 'Milestone description' },
  projectId: { type: 'string', description: 'Project ID' },
  targetDate: { type: 'string', description: 'Target date (YYYY-MM-DD)' },
  progress: { type: 'number', description: 'Progress percentage (0-1)' },
  sortOrder: { type: 'number', description: 'Sort order within the project' },
  status: { type: 'string', description: 'Milestone status (done, next, overdue, unstarted)' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  archivedAt: { type: 'string', description: 'Archive timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for nested project milestone objects
 */
export const PROJECT_MILESTONE_MINIMAL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Project milestone ID' },
  name: { type: 'string', description: 'Milestone name' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for project status objects
 */
export const PROJECT_STATUS_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Project status ID' },
  name: { type: 'string', description: 'Status name' },
  description: { type: 'string', description: 'Status description' },
  color: { type: 'string', description: 'Status color (hex)' },
  indefinite: { type: 'boolean', description: 'Whether this status is indefinite' },
  position: { type: 'number', description: 'Position in list' },
  type: {
    type: 'string',
    description: 'Status type (backlog, planned, started, paused, completed, canceled)',
  },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last updated timestamp (ISO 8601)' },
  archivedAt: { type: 'string', description: 'Archive timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Pagination output properties for list endpoints
 */
export const PAGE_INFO_OUTPUT_PROPERTIES = {
  hasNextPage: { type: 'boolean', description: 'Whether there are more results' },
  endCursor: { type: 'string', description: 'Cursor for the next page' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete pagination output definition
 */
export const PAGE_INFO_OUTPUT = {
  type: 'object' as const,
  description: 'Pagination information',
  properties: PAGE_INFO_OUTPUT_PROPERTIES,
}

/**
 * Output definition for issue objects in list/read responses (includes team/project names)
 */
export const ISSUE_LIST_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Issue ID' },
  title: { type: 'string', description: 'Issue title' },
  description: { type: 'string', description: 'Issue description' },
  priority: {
    type: 'number',
    description: 'Priority (0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low)',
  },
  estimate: { type: 'number', description: 'Estimate in points' },
  url: { type: 'string', description: 'Issue URL' },
  dueDate: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
  createdAt: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
  updatedAt: { type: 'string', description: 'Last update timestamp (ISO 8601)' },
  archivedAt: { type: 'string', description: 'Archive timestamp (ISO 8601)' },
  state: STATE_OUTPUT,
  assignee: USER_OUTPUT,
  teamId: { type: 'string', description: 'Team ID' },
  teamName: { type: 'string', description: 'Team name' },
  projectId: { type: 'string', description: 'Project ID' },
  projectName: { type: 'string', description: 'Project name' },
  cycleId: { type: 'string', description: 'Cycle ID' },
  cycleNumber: { type: 'number', description: 'Cycle number' },
  cycleName: { type: 'string', description: 'Cycle name' },
  labels: LABELS_OUTPUT,
} as const satisfies Record<string, OutputProperty>

// ===== Core Types =====

export interface LinearIssue {
  id: string
  title: string
  description?: string
  state?: {
    id: string
    name: string
    type: string
  }
  assignee?: {
    id: string
    name: string
    email: string
  }
  priority?: number
  estimate?: number
  teamId?: string
  projectId?: string
  labels?: Array<{
    id: string
    name: string
    color: string
  }>
  createdAt?: string
  updatedAt?: string
  completedAt?: string
  canceledAt?: string
  archivedAt?: string
  url?: string
}

export interface LinearComment {
  id: string
  body: string
  createdAt: string
  updatedAt?: string
  user: {
    id: string
    name: string
    email?: string
  }
  issue?: {
    id: string
    title: string
  }
}

export interface LinearProject {
  id: string
  name: string
  description?: string
  state: string
  priority: number
  startDate?: string
  targetDate?: string
  completedAt?: string
  canceledAt?: string
  archivedAt?: string
  lead?: {
    id: string
    name: string
  }
  teams?: Array<{
    id: string
    name: string
  }>
  url?: string
}

export interface LinearUser {
  id: string
  name: string
  email: string
  displayName: string
  active: boolean
  admin: boolean
  avatarUrl?: string
}

export interface LinearTeam {
  id: string
  name: string
  key: string
  description?: string
}

export interface LinearLabel {
  id: string
  name: string
  color: string
  description?: string
  isGroup: boolean
  createdAt: string
  updatedAt: string
  archivedAt?: string
  team?: {
    id: string
    name: string
  }
}

export interface LinearWorkflowState {
  id: string
  name: string
  description?: string
  type: string
  color: string
  position: number
  createdAt: string
  updatedAt: string
  archivedAt?: string
  team: {
    id: string
    name: string
  }
}

export interface LinearCycle {
  id: string
  number: number
  name?: string
  startsAt: string
  endsAt: string
  completedAt?: string
  progress: number
  createdAt: string
  team: {
    id: string
    name: string
  }
}

// ===== Request Params =====

export interface LinearReadIssuesParams {
  teamId?: string
  projectId?: string
  assigneeId?: string
  stateId?: string
  priority?: number
  labelIds?: string[]
  createdAfter?: string
  updatedAfter?: string
  includeArchived?: boolean
  first?: number
  after?: string
  orderBy?: 'createdAt' | 'updatedAt'
  accessToken?: string
}

export interface LinearGetIssueParams {
  issueId: string
  accessToken?: string
}

export interface LinearCreateIssueParams {
  teamId: string
  projectId?: string
  title: string
  description?: string
  stateId?: string
  assigneeId?: string
  priority?: number
  estimate?: number
  labelIds?: string[]
  cycleId?: string
  parentId?: string
  dueDate?: string
  subscriberIds?: string[]
  projectMilestoneId?: string
  accessToken?: string
}

export interface LinearUpdateIssueParams {
  issueId: string
  title?: string
  description?: string
  stateId?: string
  assigneeId?: string
  priority?: number
  estimate?: number
  labelIds?: string[]
  projectId?: string
  cycleId?: string
  parentId?: string
  dueDate?: string
  addedLabelIds?: string[]
  removedLabelIds?: string[]
  accessToken?: string
}

export interface LinearArchiveIssueParams {
  issueId: string
  accessToken?: string
}

export interface LinearUnarchiveIssueParams {
  issueId: string
  accessToken?: string
}

export interface LinearDeleteIssueParams {
  issueId: string
  accessToken?: string
}

export interface LinearAddLabelToIssueParams {
  issueId: string
  labelId: string
  accessToken?: string
}

export interface LinearRemoveLabelFromIssueParams {
  issueId: string
  labelId: string
  accessToken?: string
}

export interface LinearSearchIssuesParams {
  query: string
  teamId?: string
  includeArchived?: boolean
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearCreateCommentParams {
  issueId: string
  body: string
  accessToken?: string
}

export interface LinearUpdateCommentParams {
  commentId: string
  body: string
  accessToken?: string
}

export interface LinearDeleteCommentParams {
  commentId: string
  accessToken?: string
}

export interface LinearListCommentsParams {
  issueId: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearListProjectsParams {
  teamId?: string
  includeArchived?: boolean
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearGetProjectParams {
  projectId: string
  accessToken?: string
}

export interface LinearCreateProjectParams {
  teamId: string
  name: string
  description?: string
  leadId?: string
  startDate?: string
  targetDate?: string
  priority?: number
  accessToken?: string
}

export interface LinearUpdateProjectParams {
  projectId: string
  name?: string
  description?: string
  state?: string
  leadId?: string
  startDate?: string
  targetDate?: string
  priority?: number
  accessToken?: string
}

export interface LinearArchiveProjectParams {
  projectId: string
  accessToken?: string
}

export interface LinearListUsersParams {
  includeDisabled?: boolean
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearListTeamsParams {
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearGetViewerParams {
  accessToken?: string
}

export interface LinearListLabelsParams {
  teamId?: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearCreateLabelParams {
  name: string
  color?: string
  description?: string
  teamId?: string
  accessToken?: string
}

export interface LinearUpdateLabelParams {
  labelId: string
  name?: string
  color?: string
  description?: string
  accessToken?: string
}

export interface LinearArchiveLabelParams {
  labelId: string
  accessToken?: string
}

export interface LinearListWorkflowStatesParams {
  teamId?: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearCreateWorkflowStateParams {
  teamId: string
  name: string
  color?: string
  type: string
  description?: string
  position?: number
  accessToken?: string
}

export interface LinearUpdateWorkflowStateParams {
  stateId: string
  name?: string
  color?: string
  description?: string
  position?: number
  accessToken?: string
}

export interface LinearListCyclesParams {
  teamId?: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearGetCycleParams {
  cycleId: string
  accessToken?: string
}

export interface LinearCreateCycleParams {
  teamId: string
  startsAt: string
  endsAt: string
  name?: string
  accessToken?: string
}

export interface LinearGetActiveCycleParams {
  teamId: string
  accessToken?: string
}

export interface LinearCreateAttachmentParams {
  issueId: string
  url?: string
  file?: UserFile
  title?: string
  subtitle?: string
  accessToken?: string
}

export interface LinearListAttachmentsParams {
  issueId: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearUpdateAttachmentParams {
  attachmentId: string
  title: string
  subtitle?: string
  accessToken?: string
}

export interface LinearDeleteAttachmentParams {
  attachmentId: string
  accessToken?: string
}

export interface LinearCreateIssueRelationParams {
  issueId: string
  relatedIssueId: string
  type: string
  accessToken?: string
}

export interface LinearListIssueRelationsParams {
  issueId: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearDeleteIssueRelationParams {
  relationId: string
  accessToken?: string
}

export interface LinearCreateFavoriteParams {
  issueId?: string
  projectId?: string
  cycleId?: string
  labelId?: string
  accessToken?: string
}

export interface LinearListFavoritesParams {
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearCreateProjectUpdateParams {
  projectId: string
  body: string
  health?: string
  accessToken?: string
}

export interface LinearListProjectUpdatesParams {
  projectId: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearListNotificationsParams {
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearUpdateNotificationParams {
  notificationId: string
  readAt?: string
  accessToken?: string
}

// ===== Response Types =====

export interface LinearReadIssuesResponse extends ToolResponse {
  output: {
    issues?: LinearIssue[]
  }
}

export interface LinearGetIssueResponse extends ToolResponse {
  output: {
    issue?: LinearIssue
  }
}

export interface LinearCreateIssueResponse extends ToolResponse {
  output: {
    issue?: LinearIssue
  }
}

export interface LinearUpdateIssueResponse extends ToolResponse {
  output: {
    issue?: LinearIssue
  }
}

export interface LinearArchiveIssueResponse extends ToolResponse {
  output: {
    success?: boolean
    issueId?: string
  }
}

export interface LinearUnarchiveIssueResponse extends ToolResponse {
  output: {
    success?: boolean
    issueId?: string
  }
}

export interface LinearDeleteIssueResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearAddLabelResponse extends ToolResponse {
  output: {
    success?: boolean
    issueId?: string
  }
}

export interface LinearRemoveLabelResponse extends ToolResponse {
  output: {
    success?: boolean
    issueId?: string
  }
}

export interface LinearSearchIssuesResponse extends ToolResponse {
  output: {
    issues?: LinearIssue[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearCreateCommentResponse extends ToolResponse {
  output: {
    comment?: LinearComment
  }
}

export interface LinearUpdateCommentResponse extends ToolResponse {
  output: {
    comment?: LinearComment
  }
}

export interface LinearDeleteCommentResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearListCommentsResponse extends ToolResponse {
  output: {
    comments?: LinearComment[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearListProjectsResponse extends ToolResponse {
  output: {
    projects?: LinearProject[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearGetProjectResponse extends ToolResponse {
  output: {
    project?: LinearProject
  }
}

export interface LinearCreateProjectResponse extends ToolResponse {
  output: {
    project?: LinearProject
  }
}

export interface LinearUpdateProjectResponse extends ToolResponse {
  output: {
    project?: LinearProject
  }
}

export interface LinearArchiveProjectResponse extends ToolResponse {
  output: {
    success?: boolean
    projectId?: string
  }
}

export interface LinearListUsersResponse extends ToolResponse {
  output: {
    users?: LinearUser[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearListTeamsResponse extends ToolResponse {
  output: {
    teams?: LinearTeam[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearGetViewerResponse extends ToolResponse {
  output: {
    user?: LinearUser
  }
}

export interface LinearListLabelsResponse extends ToolResponse {
  output: {
    labels?: LinearLabel[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearCreateLabelResponse extends ToolResponse {
  output: {
    label?: LinearLabel
  }
}

export interface LinearUpdateLabelResponse extends ToolResponse {
  output: {
    label?: LinearLabel
  }
}

export interface LinearArchiveLabelResponse extends ToolResponse {
  output: {
    success?: boolean
    labelId?: string
  }
}

export interface LinearListWorkflowStatesResponse extends ToolResponse {
  output: {
    states?: LinearWorkflowState[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearCreateWorkflowStateResponse extends ToolResponse {
  output: {
    state?: LinearWorkflowState
  }
}

export interface LinearUpdateWorkflowStateResponse extends ToolResponse {
  output: {
    state?: LinearWorkflowState
  }
}

export interface LinearListCyclesResponse extends ToolResponse {
  output: {
    cycles?: LinearCycle[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearGetCycleResponse extends ToolResponse {
  output: {
    cycle?: LinearCycle
  }
}

export interface LinearCreateCycleResponse extends ToolResponse {
  output: {
    cycle?: LinearCycle
  }
}

export interface LinearGetActiveCycleResponse extends ToolResponse {
  output: {
    cycle?: LinearCycle | null
  }
}

export interface LinearAttachment {
  id: string
  title?: string
  subtitle?: string
  url: string
  createdAt: string
  updatedAt: string
}

export interface LinearCreateAttachmentResponse extends ToolResponse {
  output: {
    attachment?: LinearAttachment
  }
}

export interface LinearListAttachmentsResponse extends ToolResponse {
  output: {
    attachments?: LinearAttachment[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearUpdateAttachmentResponse extends ToolResponse {
  output: {
    attachment?: LinearAttachment
  }
}

export interface LinearDeleteAttachmentResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearIssueRelation {
  id: string
  type: string
  issue: {
    id: string
    title: string
  }
  relatedIssue: {
    id: string
    title: string
  }
}

export interface LinearCreateIssueRelationResponse extends ToolResponse {
  output: {
    relation?: LinearIssueRelation
  }
}

export interface LinearListIssueRelationsResponse extends ToolResponse {
  output: {
    relations?: LinearIssueRelation[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearDeleteIssueRelationResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearFavorite {
  id: string
  type: string
  issue?: {
    id: string
    title: string
  }
  project?: {
    id: string
    name: string
  }
  cycle?: {
    id: string
    name: string
  }
}

export interface LinearCreateFavoriteResponse extends ToolResponse {
  output: {
    favorite?: LinearFavorite
  }
}

export interface LinearListFavoritesResponse extends ToolResponse {
  output: {
    favorites?: LinearFavorite[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearProjectUpdate {
  id: string
  body: string
  health: string
  createdAt: string
  user: {
    id: string
    name: string
  }
}

export interface LinearCreateProjectUpdateResponse extends ToolResponse {
  output: {
    update?: LinearProjectUpdate
  }
}

export interface LinearListProjectUpdatesResponse extends ToolResponse {
  output: {
    updates?: LinearProjectUpdate[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearNotification {
  id: string
  type: string
  createdAt: string
  readAt?: string
  issue?: {
    id: string
    title: string
  }
}

export interface LinearListNotificationsResponse extends ToolResponse {
  output: {
    notifications?: LinearNotification[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearUpdateNotificationResponse extends ToolResponse {
  output: {
    notification?: LinearNotification
  }
}

// ===== Customer Types =====

export interface LinearCustomer {
  id: string
  name: string
  domains: string[]
  externalIds: string[]
  logoUrl?: string
  slugId: string
  approximateNeedCount: number
  revenue?: number
  size?: number
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface LinearCreateCustomerParams {
  name: string
  domains?: string[]
  externalIds?: string[]
  logoUrl?: string
  ownerId?: string
  revenue?: number
  size?: number
  statusId?: string
  tierId?: string
  accessToken?: string
}

export interface LinearCreateCustomerResponse extends ToolResponse {
  output: {
    customer?: LinearCustomer
  }
}

export interface LinearListCustomersParams {
  first?: number
  after?: string
  includeArchived?: boolean
  accessToken?: string
}

export interface LinearListCustomersResponse extends ToolResponse {
  output: {
    customers?: LinearCustomer[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

// ===== Customer Need (Request) Types =====

export interface LinearCustomerNeed {
  id: string
  body?: string
  priority: number
  createdAt: string
  updatedAt: string
  archivedAt?: string
  customer?: {
    id: string
    name: string
  }
  issue?: {
    id: string
    title: string
  }
  project?: {
    id: string
    name: string
  }
  creator?: {
    id: string
    name: string
  }
  url?: string
}

export interface LinearCreateCustomerRequestParams {
  customerId: string
  body?: string
  priority?: number
  issueId?: string
  projectId?: string
  accessToken?: string
}

export interface LinearCreateCustomerRequestResponse extends ToolResponse {
  output: {
    customerNeed?: LinearCustomerNeed
  }
}

export interface LinearUpdateCustomerRequestParams {
  customerNeedId: string
  body?: string
  priority?: number
  customerId?: string
  issueId?: string
  projectId?: string
  accessToken?: string
}

export interface LinearUpdateCustomerRequestResponse extends ToolResponse {
  output: {
    customerNeed?: LinearCustomerNeed
  }
}

export interface LinearListCustomerRequestsParams {
  first?: number
  after?: string
  includeArchived?: boolean
  accessToken?: string
}

export interface LinearListCustomerRequestsResponse extends ToolResponse {
  output: {
    customerNeeds?: LinearCustomerNeed[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearGetCustomerParams {
  customerId: string
  accessToken?: string
}

export interface LinearGetCustomerResponse extends ToolResponse {
  output: {
    customer?: LinearCustomer
  }
}

export interface LinearUpdateCustomerParams {
  customerId: string
  name?: string
  domains?: string[]
  externalIds?: string[]
  logoUrl?: string
  ownerId?: string
  revenue?: number
  size?: number
  statusId?: string
  tierId?: string
  accessToken?: string
}

export interface LinearUpdateCustomerResponse extends ToolResponse {
  output: {
    customer?: LinearCustomer
  }
}

export interface LinearDeleteCustomerParams {
  customerId: string
  accessToken?: string
}

export interface LinearDeleteCustomerResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearMergeCustomersParams {
  sourceCustomerId: string
  targetCustomerId: string
  accessToken?: string
}

export interface LinearMergeCustomersResponse extends ToolResponse {
  output: {
    customer?: LinearCustomer
  }
}

// ===== Customer Status Types =====

export interface LinearCustomerStatus {
  id: string
  name: string
  description?: string
  color: string
  position: number
  type: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface LinearCreateCustomerStatusParams {
  name: string
  color: string
  displayName?: string
  description?: string
  position?: number
  accessToken?: string
}

export interface LinearCreateCustomerStatusResponse extends ToolResponse {
  output: {
    customerStatus?: LinearCustomerStatus
  }
}

export interface LinearUpdateCustomerStatusParams {
  statusId: string
  name?: string
  color?: string
  displayName?: string
  description?: string
  position?: number
  accessToken?: string
}

export interface LinearUpdateCustomerStatusResponse extends ToolResponse {
  output: {
    customerStatus?: LinearCustomerStatus
  }
}

export interface LinearDeleteCustomerStatusParams {
  statusId: string
  accessToken?: string
}

export interface LinearDeleteCustomerStatusResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearListCustomerStatusesParams {
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearListCustomerStatusesResponse extends ToolResponse {
  output: {
    customerStatuses?: LinearCustomerStatus[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

// ===== Customer Tier Types =====

export interface LinearCustomerTier {
  id: string
  name: string
  displayName: string
  description?: string
  color: string
  position: number
  createdAt: string
  archivedAt?: string
}

export interface LinearCreateCustomerTierParams {
  name: string
  color: string
  displayName?: string
  description?: string
  position?: number
  accessToken?: string
}

export interface LinearCreateCustomerTierResponse extends ToolResponse {
  output: {
    customerTier?: LinearCustomerTier
  }
}

export interface LinearUpdateCustomerTierParams {
  tierId: string
  name?: string
  color?: string
  displayName?: string
  description?: string
  position?: number
  accessToken?: string
}

export interface LinearUpdateCustomerTierResponse extends ToolResponse {
  output: {
    customerTier?: LinearCustomerTier
  }
}

export interface LinearDeleteCustomerTierParams {
  tierId: string
  accessToken?: string
}

export interface LinearDeleteCustomerTierResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearListCustomerTiersParams {
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearListCustomerTiersResponse extends ToolResponse {
  output: {
    customerTiers?: LinearCustomerTier[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

// ===== Project Label Types =====

export interface LinearProjectLabel {
  id: string
  name: string
  description?: string
  color?: string
  isGroup: boolean
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface LinearCreateProjectLabelParams {
  name: string
  color?: string
  description?: string
  isGroup?: boolean
  parentId?: string
  accessToken?: string
}

export interface LinearCreateProjectLabelResponse extends ToolResponse {
  output: {
    projectLabel?: LinearProjectLabel
  }
}

export interface LinearUpdateProjectLabelParams {
  labelId: string
  name?: string
  color?: string
  description?: string
  accessToken?: string
}

export interface LinearUpdateProjectLabelResponse extends ToolResponse {
  output: {
    projectLabel?: LinearProjectLabel
  }
}

export interface LinearDeleteProjectLabelParams {
  labelId: string
  accessToken?: string
}

export interface LinearDeleteProjectLabelResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearListProjectLabelsParams {
  projectId?: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearListProjectLabelsResponse extends ToolResponse {
  output: {
    projectLabels?: LinearProjectLabel[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearAddLabelToProjectParams {
  projectId: string
  labelId: string
  accessToken?: string
}

export interface LinearAddLabelToProjectResponse extends ToolResponse {
  output: {
    success?: boolean
    projectId?: string
  }
}

export interface LinearRemoveLabelFromProjectParams {
  projectId: string
  labelId: string
  accessToken?: string
}

export interface LinearRemoveLabelFromProjectResponse extends ToolResponse {
  output: {
    success?: boolean
    projectId?: string
  }
}

// ===== Project Milestone Types =====

export interface LinearProjectMilestone {
  id: string
  name: string
  description?: string
  projectId: string
  targetDate?: string
  progress: number
  sortOrder: number
  status: string
  createdAt: string
  archivedAt?: string
}

export interface LinearCreateProjectMilestoneParams {
  projectId: string
  name: string
  description?: string
  targetDate?: string
  accessToken?: string
}

export interface LinearCreateProjectMilestoneResponse extends ToolResponse {
  output: {
    projectMilestone?: LinearProjectMilestone
  }
}

export interface LinearUpdateProjectMilestoneParams {
  milestoneId: string
  name?: string
  description?: string
  targetDate?: string
  accessToken?: string
}

export interface LinearUpdateProjectMilestoneResponse extends ToolResponse {
  output: {
    projectMilestone?: LinearProjectMilestone
  }
}

export interface LinearDeleteProjectMilestoneParams {
  milestoneId: string
  accessToken?: string
}

export interface LinearDeleteProjectMilestoneResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearListProjectMilestonesParams {
  projectId: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearListProjectMilestonesResponse extends ToolResponse {
  output: {
    projectMilestones?: LinearProjectMilestone[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

// ===== Project Status Types =====

export interface LinearProjectStatus {
  id: string
  name: string
  description?: string
  color: string
  indefinite: boolean
  position: number
  type: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface LinearCreateProjectStatusParams {
  name: string
  type: 'backlog' | 'planned' | 'started' | 'paused' | 'completed' | 'canceled'
  color: string
  position: number
  description?: string
  indefinite?: boolean
  accessToken?: string
}

export interface LinearCreateProjectStatusResponse extends ToolResponse {
  output: {
    projectStatus?: LinearProjectStatus
  }
}

export interface LinearUpdateProjectStatusParams {
  statusId: string
  name?: string
  color?: string
  description?: string
  indefinite?: boolean
  position?: number
  accessToken?: string
}

export interface LinearUpdateProjectStatusResponse extends ToolResponse {
  output: {
    projectStatus?: LinearProjectStatus
  }
}

export interface LinearDeleteProjectStatusParams {
  statusId: string
  accessToken?: string
}

export interface LinearDeleteProjectStatusResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearListProjectStatusesParams {
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearListProjectStatusesResponse extends ToolResponse {
  output: {
    projectStatuses?: LinearProjectStatus[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

// ===== Project Delete Types =====

export interface LinearDeleteProjectParams {
  projectId: string
  accessToken?: string
}

export interface LinearDeleteProjectResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export type LinearResponse =
  | LinearReadIssuesResponse
  | LinearGetIssueResponse
  | LinearCreateIssueResponse
  | LinearUpdateIssueResponse
  | LinearArchiveIssueResponse
  | LinearUnarchiveIssueResponse
  | LinearDeleteIssueResponse
  | LinearAddLabelResponse
  | LinearRemoveLabelResponse
  | LinearSearchIssuesResponse
  | LinearCreateCommentResponse
  | LinearUpdateCommentResponse
  | LinearDeleteCommentResponse
  | LinearListCommentsResponse
  | LinearListProjectsResponse
  | LinearGetProjectResponse
  | LinearCreateProjectResponse
  | LinearUpdateProjectResponse
  | LinearArchiveProjectResponse
  | LinearListUsersResponse
  | LinearListTeamsResponse
  | LinearGetViewerResponse
  | LinearListLabelsResponse
  | LinearCreateLabelResponse
  | LinearUpdateLabelResponse
  | LinearArchiveLabelResponse
  | LinearListWorkflowStatesResponse
  | LinearCreateWorkflowStateResponse
  | LinearUpdateWorkflowStateResponse
  | LinearListCyclesResponse
  | LinearGetCycleResponse
  | LinearCreateCycleResponse
  | LinearGetActiveCycleResponse
  | LinearCreateAttachmentResponse
  | LinearListAttachmentsResponse
  | LinearUpdateAttachmentResponse
  | LinearDeleteAttachmentResponse
  | LinearCreateIssueRelationResponse
  | LinearListIssueRelationsResponse
  | LinearDeleteIssueRelationResponse
  | LinearCreateFavoriteResponse
  | LinearListFavoritesResponse
  | LinearCreateProjectUpdateResponse
  | LinearListProjectUpdatesResponse
  | LinearListNotificationsResponse
  | LinearUpdateNotificationResponse
  | LinearCreateCustomerResponse
  | LinearListCustomersResponse
  | LinearGetCustomerResponse
  | LinearUpdateCustomerResponse
  | LinearDeleteCustomerResponse
  | LinearMergeCustomersResponse
  | LinearCreateCustomerRequestResponse
  | LinearUpdateCustomerRequestResponse
  | LinearListCustomerRequestsResponse
  | LinearCreateCustomerStatusResponse
  | LinearUpdateCustomerStatusResponse
  | LinearDeleteCustomerStatusResponse
  | LinearListCustomerStatusesResponse
  | LinearCreateCustomerTierResponse
  | LinearUpdateCustomerTierResponse
  | LinearDeleteCustomerTierResponse
  | LinearListCustomerTiersResponse
  | LinearDeleteProjectResponse
  | LinearCreateProjectLabelResponse
  | LinearUpdateProjectLabelResponse
  | LinearDeleteProjectLabelResponse
  | LinearListProjectLabelsResponse
  | LinearAddLabelToProjectResponse
  | LinearRemoveLabelFromProjectResponse
  | LinearCreateProjectMilestoneResponse
  | LinearUpdateProjectMilestoneResponse
  | LinearDeleteProjectMilestoneResponse
  | LinearListProjectMilestonesResponse
  | LinearCreateProjectStatusResponse
  | LinearUpdateProjectStatusResponse
  | LinearDeleteProjectStatusResponse
  | LinearListProjectStatusesResponse
