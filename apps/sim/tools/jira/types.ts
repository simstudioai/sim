import type { UserFile } from '@/executor/types'
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property constants for Jira tools.
 * Based on Jira Cloud REST API v3 response schemas:
 * @see https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
 * @see https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/
 * @see https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/
 * @see https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/
 */

/**
 * User object properties shared across issues, comments, and worklogs.
 * Based on Jira API v3 user structure (accountId-based).
 */
export const USER_OUTPUT_PROPERTIES = {
  accountId: { type: 'string', description: 'Atlassian account ID of the user' },
  displayName: { type: 'string', description: 'Display name of the user' },
  active: { type: 'boolean', description: 'Whether the user account is active', optional: true },
  emailAddress: { type: 'string', description: 'Email address of the user', optional: true },
  accountType: {
    type: 'string',
    description: 'Type of account (e.g., atlassian, app, customer)',
    optional: true,
  },
  avatarUrl: {
    type: 'string',
    description: 'URL to the user avatar (48x48)',
    optional: true,
  },
  timeZone: { type: 'string', description: 'User timezone', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * User object output definition.
 */
export const USER_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Jira user object',
  properties: USER_OUTPUT_PROPERTIES,
}

/**
 * Status object properties from Jira API v3.
 * Based on IssueBean.fields.status structure.
 */
export const STATUS_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Status ID' },
  name: { type: 'string', description: 'Status name (e.g., Open, In Progress, Done)' },
  description: { type: 'string', description: 'Status description', optional: true },
  statusCategory: {
    type: 'object',
    description: 'Status category grouping',
    properties: {
      id: { type: 'number', description: 'Status category ID' },
      key: {
        type: 'string',
        description: 'Status category key (e.g., new, indeterminate, done)',
      },
      name: {
        type: 'string',
        description: 'Status category name (e.g., To Do, In Progress, Done)',
      },
      colorName: {
        type: 'string',
        description: 'Status category color (e.g., blue-gray, yellow, green)',
      },
    },
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Status object output definition.
 */
export const STATUS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Issue status',
  properties: STATUS_OUTPUT_PROPERTIES,
}

/**
 * Issue type object properties from Jira API v3.
 * Based on IssueBean.fields.issuetype structure.
 */
export const ISSUE_TYPE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Issue type ID' },
  name: { type: 'string', description: 'Issue type name (e.g., Task, Bug, Story, Epic)' },
  description: { type: 'string', description: 'Issue type description', optional: true },
  subtask: { type: 'boolean', description: 'Whether this is a subtask type' },
  iconUrl: { type: 'string', description: 'URL to the issue type icon', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Issue type object output definition.
 */
export const ISSUE_TYPE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Issue type',
  properties: ISSUE_TYPE_OUTPUT_PROPERTIES,
}

/**
 * Project object properties from Jira API v3.
 * Based on IssueBean.fields.project structure.
 */
export const PROJECT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Project ID' },
  key: { type: 'string', description: 'Project key (e.g., PROJ)' },
  name: { type: 'string', description: 'Project name' },
  projectTypeKey: {
    type: 'string',
    description: 'Project type key (e.g., software, business)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Project object output definition.
 */
export const PROJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Jira project',
  properties: PROJECT_OUTPUT_PROPERTIES,
}

/**
 * Priority object properties from Jira API v3.
 * Based on IssueBean.fields.priority structure.
 */
export const PRIORITY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Priority ID' },
  name: { type: 'string', description: 'Priority name (e.g., Highest, High, Medium, Low, Lowest)' },
  iconUrl: { type: 'string', description: 'URL to the priority icon', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Priority object output definition.
 */
export const PRIORITY_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Issue priority',
  properties: PRIORITY_OUTPUT_PROPERTIES,
}

/**
 * Resolution object properties from Jira API v3.
 * Based on IssueBean.fields.resolution structure.
 */
export const RESOLUTION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Resolution ID' },
  name: { type: 'string', description: "Resolution name (e.g., Fixed, Duplicate, Won't Fix)" },
  description: { type: 'string', description: 'Resolution description', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Resolution object output definition.
 */
export const RESOLUTION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Issue resolution',
  properties: RESOLUTION_OUTPUT_PROPERTIES,
  optional: true,
}

/**
 * Component object properties from Jira API v3.
 * Based on IssueBean.fields.components structure.
 */
export const COMPONENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Component ID' },
  name: { type: 'string', description: 'Component name' },
  description: { type: 'string', description: 'Component description', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Version object properties from Jira API v3.
 * Based on IssueBean.fields.fixVersions / versions structure.
 */
export const VERSION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Version ID' },
  name: { type: 'string', description: 'Version name' },
  released: { type: 'boolean', description: 'Whether the version is released', optional: true },
  releaseDate: { type: 'string', description: 'Release date (YYYY-MM-DD)', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Time tracking object properties from Jira API v3.
 * Based on IssueBean.fields.timetracking structure.
 */
export const TIME_TRACKING_OUTPUT_PROPERTIES = {
  originalEstimate: {
    type: 'string',
    description: 'Original estimate in human-readable format (e.g., 1w 2d)',
    optional: true,
  },
  remainingEstimate: {
    type: 'string',
    description: 'Remaining estimate in human-readable format',
    optional: true,
  },
  timeSpent: {
    type: 'string',
    description: 'Time spent in human-readable format',
    optional: true,
  },
  originalEstimateSeconds: {
    type: 'number',
    description: 'Original estimate in seconds',
    optional: true,
  },
  remainingEstimateSeconds: {
    type: 'number',
    description: 'Remaining estimate in seconds',
    optional: true,
  },
  timeSpentSeconds: {
    type: 'number',
    description: 'Time spent in seconds',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Time tracking object output definition.
 */
export const TIME_TRACKING_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Time tracking information',
  properties: TIME_TRACKING_OUTPUT_PROPERTIES,
  optional: true,
}

/**
 * Issue link object properties from Jira API v3.
 * Based on IssueBean.fields.issuelinks structure.
 */
export const ISSUE_LINK_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Issue link ID' },
  type: {
    type: 'object',
    description: 'Link type information',
    properties: {
      id: { type: 'string', description: 'Link type ID' },
      name: { type: 'string', description: 'Link type name (e.g., Blocks, Relates)' },
      inward: { type: 'string', description: 'Inward description (e.g., is blocked by)' },
      outward: { type: 'string', description: 'Outward description (e.g., blocks)' },
    },
  },
  inwardIssue: {
    type: 'object',
    description: 'Inward linked issue',
    properties: {
      id: { type: 'string', description: 'Issue ID' },
      key: { type: 'string', description: 'Issue key' },
      statusName: { type: 'string', description: 'Issue status name', optional: true },
      summary: { type: 'string', description: 'Issue summary', optional: true },
    },
    optional: true,
  },
  outwardIssue: {
    type: 'object',
    description: 'Outward linked issue',
    properties: {
      id: { type: 'string', description: 'Issue ID' },
      key: { type: 'string', description: 'Issue key' },
      statusName: { type: 'string', description: 'Issue status name', optional: true },
      summary: { type: 'string', description: 'Issue summary', optional: true },
    },
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Subtask item properties from Jira API v3.
 */
export const SUBTASK_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Subtask issue ID' },
  key: { type: 'string', description: 'Subtask issue key' },
  summary: { type: 'string', description: 'Subtask summary' },
  statusName: { type: 'string', description: 'Subtask status name' },
  issueTypeName: { type: 'string', description: 'Subtask issue type name', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Comment item properties from Jira API v3.
 * Based on GET /rest/api/3/issue/{issueIdOrKey}/comment response.
 */
export const COMMENT_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Comment ID' },
  body: { type: 'string', description: 'Comment body text (extracted from ADF)' },
  author: {
    type: 'object',
    description: 'Comment author',
    properties: USER_OUTPUT_PROPERTIES,
  },
  updateAuthor: {
    type: 'object',
    description: 'User who last updated the comment',
    properties: USER_OUTPUT_PROPERTIES,
    optional: true,
  },
  created: { type: 'string', description: 'ISO 8601 timestamp when the comment was created' },
  updated: { type: 'string', description: 'ISO 8601 timestamp when the comment was last updated' },
  visibility: {
    type: 'object',
    description: 'Comment visibility restriction',
    properties: {
      type: { type: 'string', description: 'Restriction type (e.g., role, group)' },
      value: { type: 'string', description: 'Restriction value (e.g., Administrators)' },
    },
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Comment object output definition.
 */
export const COMMENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Jira comment object',
  properties: COMMENT_ITEM_PROPERTIES,
}

/**
 * Comments array output definition.
 */
export const COMMENTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Jira comments',
  items: {
    type: 'object',
    properties: COMMENT_ITEM_PROPERTIES,
  },
}

/**
 * Attachment item properties from Jira API v3.
 * Based on IssueBean.fields.attachment structure.
 */
export const ATTACHMENT_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Attachment ID' },
  filename: { type: 'string', description: 'Attachment file name' },
  mimeType: { type: 'string', description: 'MIME type of the attachment' },
  size: { type: 'number', description: 'File size in bytes' },
  content: { type: 'string', description: 'URL to download the attachment content' },
  thumbnail: {
    type: 'string',
    description: 'URL to the attachment thumbnail',
    optional: true,
  },
  author: {
    type: 'object',
    description: 'Attachment author',
    properties: USER_OUTPUT_PROPERTIES,
    optional: true,
  },
  created: { type: 'string', description: 'ISO 8601 timestamp when the attachment was created' },
} as const satisfies Record<string, OutputProperty>

/**
 * Attachment object output definition.
 */
export const ATTACHMENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Jira attachment object',
  properties: ATTACHMENT_ITEM_PROPERTIES,
}

/**
 * Attachments array output definition.
 */
export const ATTACHMENTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Jira attachments',
  items: {
    type: 'object',
    properties: ATTACHMENT_ITEM_PROPERTIES,
  },
}

/**
 * Worklog item properties from Jira API v3.
 * Based on GET /rest/api/3/issue/{issueIdOrKey}/worklog response.
 */
export const WORKLOG_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Worklog ID' },
  author: {
    type: 'object',
    description: 'Worklog author',
    properties: USER_OUTPUT_PROPERTIES,
  },
  updateAuthor: {
    type: 'object',
    description: 'User who last updated the worklog',
    properties: USER_OUTPUT_PROPERTIES,
    optional: true,
  },
  comment: { type: 'string', description: 'Worklog comment text', optional: true },
  started: { type: 'string', description: 'ISO 8601 timestamp when the work started' },
  timeSpent: { type: 'string', description: 'Time spent in human-readable format (e.g., 3h 20m)' },
  timeSpentSeconds: { type: 'number', description: 'Time spent in seconds' },
  created: { type: 'string', description: 'ISO 8601 timestamp when the worklog was created' },
  updated: { type: 'string', description: 'ISO 8601 timestamp when the worklog was last updated' },
} as const satisfies Record<string, OutputProperty>

/**
 * Worklog object output definition.
 */
export const WORKLOG_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Jira worklog object',
  properties: WORKLOG_ITEM_PROPERTIES,
}

/**
 * Worklogs array output definition.
 */
export const WORKLOGS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Jira worklogs',
  items: {
    type: 'object',
    properties: WORKLOG_ITEM_PROPERTIES,
  },
}

/**
 * Transition object properties from Jira API v3.
 * Based on GET /rest/api/3/issue/{issueIdOrKey}/transitions response.
 */
export const TRANSITION_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Transition ID' },
  name: { type: 'string', description: 'Transition name (e.g., Start Progress, Done)' },
  hasScreen: {
    type: 'boolean',
    description: 'Whether the transition has an associated screen',
    optional: true,
  },
  isGlobal: { type: 'boolean', description: 'Whether the transition is global', optional: true },
  isConditional: {
    type: 'boolean',
    description: 'Whether the transition is conditional',
    optional: true,
  },
  to: {
    type: 'object',
    description: 'Target status after transition',
    properties: STATUS_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Full issue item properties for retrieve/search outputs.
 * Based on IssueBean structure from Jira API v3.
 */
export const ISSUE_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Issue ID' },
  key: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
  self: { type: 'string', description: 'REST API URL for this issue' },
  summary: { type: 'string', description: 'Issue summary' },
  description: {
    type: 'string',
    description: 'Issue description text (extracted from ADF)',
    optional: true,
  },
  status: {
    type: 'object',
    description: 'Issue status',
    properties: STATUS_OUTPUT_PROPERTIES,
  },
  issuetype: {
    type: 'object',
    description: 'Issue type',
    properties: ISSUE_TYPE_OUTPUT_PROPERTIES,
  },
  project: {
    type: 'object',
    description: 'Project the issue belongs to',
    properties: PROJECT_OUTPUT_PROPERTIES,
  },
  priority: {
    type: 'object',
    description: 'Issue priority',
    properties: PRIORITY_OUTPUT_PROPERTIES,
    optional: true,
  },
  assignee: {
    type: 'object',
    description: 'Assigned user',
    properties: USER_OUTPUT_PROPERTIES,
    optional: true,
  },
  reporter: {
    type: 'object',
    description: 'Reporter user',
    properties: USER_OUTPUT_PROPERTIES,
    optional: true,
  },
  creator: {
    type: 'object',
    description: 'Issue creator',
    properties: USER_OUTPUT_PROPERTIES,
    optional: true,
  },
  labels: {
    type: 'array',
    description: 'Issue labels',
    items: { type: 'string' },
  },
  components: {
    type: 'array',
    description: 'Issue components',
    items: {
      type: 'object',
      properties: COMPONENT_OUTPUT_PROPERTIES,
    },
    optional: true,
  },
  fixVersions: {
    type: 'array',
    description: 'Fix versions',
    items: {
      type: 'object',
      properties: VERSION_OUTPUT_PROPERTIES,
    },
    optional: true,
  },
  resolution: {
    type: 'object',
    description: 'Issue resolution',
    properties: RESOLUTION_OUTPUT_PROPERTIES,
    optional: true,
  },
  duedate: { type: 'string', description: 'Due date (YYYY-MM-DD)', optional: true },
  created: { type: 'string', description: 'ISO 8601 timestamp when the issue was created' },
  updated: { type: 'string', description: 'ISO 8601 timestamp when the issue was last updated' },
  resolutiondate: {
    type: 'string',
    description: 'ISO 8601 timestamp when the issue was resolved',
    optional: true,
  },
  timetracking: TIME_TRACKING_OUTPUT,
  parent: {
    type: 'object',
    description: 'Parent issue (for subtasks)',
    properties: {
      id: { type: 'string', description: 'Parent issue ID' },
      key: { type: 'string', description: 'Parent issue key' },
      summary: { type: 'string', description: 'Parent issue summary', optional: true },
    },
    optional: true,
  },
  issuelinks: {
    type: 'array',
    description: 'Linked issues',
    items: {
      type: 'object',
      properties: ISSUE_LINK_ITEM_PROPERTIES,
    },
    optional: true,
  },
  subtasks: {
    type: 'array',
    description: 'Subtask issues',
    items: {
      type: 'object',
      properties: SUBTASK_ITEM_PROPERTIES,
    },
    optional: true,
  },
  votes: {
    type: 'object',
    description: 'Vote information',
    properties: {
      votes: { type: 'number', description: 'Number of votes' },
      hasVoted: { type: 'boolean', description: 'Whether the current user has voted' },
    },
    optional: true,
  },
  watches: {
    type: 'object',
    description: 'Watch information',
    properties: {
      watchCount: { type: 'number', description: 'Number of watchers' },
      isWatching: { type: 'boolean', description: 'Whether the current user is watching' },
    },
    optional: true,
  },
  comments: {
    type: 'array',
    description: 'Issue comments (fetched separately)',
    items: {
      type: 'object',
      properties: COMMENT_ITEM_PROPERTIES,
    },
    optional: true,
  },
  worklogs: {
    type: 'array',
    description: 'Issue worklogs (fetched separately)',
    items: {
      type: 'object',
      properties: WORKLOG_ITEM_PROPERTIES,
    },
    optional: true,
  },
  attachments: {
    type: 'array',
    description: 'Issue attachments',
    items: {
      type: 'object',
      properties: ATTACHMENT_ITEM_PROPERTIES,
    },
    optional: true,
  },
  issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Issue object output definition.
 */
export const ISSUE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Jira issue object',
  properties: ISSUE_ITEM_PROPERTIES,
}

/**
 * Issues array output definition for search endpoints.
 */
export const ISSUES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Jira issues',
  items: {
    type: 'object',
    properties: ISSUE_ITEM_PROPERTIES,
  },
}

/**
 * Search issue item properties (lighter than full issue for search results).
 * Based on POST /rest/api/3/search/jql response.
 */
export const SEARCH_ISSUE_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Issue ID' },
  key: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
  self: { type: 'string', description: 'REST API URL for this issue' },
  summary: { type: 'string', description: 'Issue summary' },
  description: {
    type: 'string',
    description: 'Issue description text (extracted from ADF)',
    optional: true,
  },
  status: {
    type: 'object',
    description: 'Issue status',
    properties: STATUS_OUTPUT_PROPERTIES,
  },
  issuetype: {
    type: 'object',
    description: 'Issue type',
    properties: ISSUE_TYPE_OUTPUT_PROPERTIES,
  },
  project: {
    type: 'object',
    description: 'Project the issue belongs to',
    properties: PROJECT_OUTPUT_PROPERTIES,
  },
  priority: {
    type: 'object',
    description: 'Issue priority',
    properties: PRIORITY_OUTPUT_PROPERTIES,
    optional: true,
  },
  assignee: {
    type: 'object',
    description: 'Assigned user',
    properties: USER_OUTPUT_PROPERTIES,
    optional: true,
  },
  reporter: {
    type: 'object',
    description: 'Reporter user',
    properties: USER_OUTPUT_PROPERTIES,
    optional: true,
  },
  labels: {
    type: 'array',
    description: 'Issue labels',
    items: { type: 'string' },
  },
  components: {
    type: 'array',
    description: 'Issue components',
    items: {
      type: 'object',
      properties: COMPONENT_OUTPUT_PROPERTIES,
    },
    optional: true,
  },
  resolution: {
    type: 'object',
    description: 'Issue resolution',
    properties: RESOLUTION_OUTPUT_PROPERTIES,
    optional: true,
  },
  duedate: { type: 'string', description: 'Due date (YYYY-MM-DD)', optional: true },
  created: { type: 'string', description: 'ISO 8601 timestamp when the issue was created' },
  updated: { type: 'string', description: 'ISO 8601 timestamp when the issue was last updated' },
} as const satisfies Record<string, OutputProperty>

/**
 * Common timestamp output property.
 */
export const TIMESTAMP_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'ISO 8601 timestamp of the operation',
}

/**
 * Common issue key output property.
 */
export const ISSUE_KEY_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Jira issue key (e.g., PROJ-123)',
}

/**
 * Common success status output property.
 */
export const SUCCESS_OUTPUT: OutputProperty = {
  type: 'boolean',
  description: 'Operation success status',
}

// --- Parameter interfaces ---

export interface JiraRetrieveParams {
  accessToken: string
  issueKey: string
  domain: string
  cloudId?: string
}

export interface JiraRetrieveResponse extends ToolResponse {
  output: {
    ts: string
    id: string
    issueKey: string
    key: string
    self: string
    summary: string
    description: string | null
    status: {
      id: string
      name: string
      description?: string
      statusCategory?: {
        id: number
        key: string
        name: string
        colorName: string
      }
    }
    issuetype: {
      id: string
      name: string
      description?: string
      subtask: boolean
      iconUrl?: string
    }
    project: {
      id: string
      key: string
      name: string
      projectTypeKey?: string
    }
    priority: {
      id: string
      name: string
      iconUrl?: string
    } | null
    assignee: {
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
    } | null
    reporter: {
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
    } | null
    creator: {
      accountId: string
      displayName: string
      active?: boolean
    } | null
    labels: string[]
    components: Array<{ id: string; name: string; description?: string }>
    fixVersions: Array<{ id: string; name: string; released?: boolean; releaseDate?: string }>
    resolution: { id: string; name: string; description?: string } | null
    duedate: string | null
    created: string
    updated: string
    resolutiondate: string | null
    timetracking: {
      originalEstimate?: string
      remainingEstimate?: string
      timeSpent?: string
      originalEstimateSeconds?: number
      remainingEstimateSeconds?: number
      timeSpentSeconds?: number
    } | null
    parent: { id: string; key: string; summary?: string } | null
    issuelinks: Array<{
      id: string
      type: { id: string; name: string; inward: string; outward: string }
      inwardIssue?: { id: string; key: string; statusName?: string; summary?: string }
      outwardIssue?: { id: string; key: string; statusName?: string; summary?: string }
    }>
    subtasks: Array<{
      id: string
      key: string
      summary: string
      statusName: string
      issueTypeName?: string
    }>
    votes: { votes: number; hasVoted: boolean } | null
    watches: { watchCount: number; isWatching: boolean } | null
    comments: Array<{
      id: string
      body: string
      author: { accountId: string; displayName: string } | null
      updateAuthor?: { accountId: string; displayName: string } | null
      created: string
      updated: string
    }>
    worklogs: Array<{
      id: string
      author: { accountId: string; displayName: string } | null
      updateAuthor?: { accountId: string; displayName: string } | null
      comment?: string | null
      started: string
      timeSpent: string
      timeSpentSeconds: number
      created: string
      updated: string
    }>
    attachments: Array<{
      id: string
      filename: string
      mimeType: string
      size: number
      content: string
      thumbnail?: string | null
      author: { accountId: string; displayName: string } | null
      created: string
    }>
    issue: Record<string, unknown>
  }
}

export interface JiraRetrieveBulkParams {
  accessToken: string
  domain: string
  projectId: string
  cloudId?: string
}

export interface JiraRetrieveResponseBulk extends ToolResponse {
  output: {
    ts: string
    total: number | null
    issues: Array<{
      id: string
      key: string
      self: string
      summary: string
      description: string | null
      status: { id: string; name: string }
      issuetype: { id: string; name: string }
      priority: { id: string; name: string } | null
      assignee: { accountId: string; displayName: string } | null
      created: string
      updated: string
    }>
    nextPageToken: string | null
    isLast: boolean
  }
}

export interface JiraUpdateParams {
  accessToken: string
  domain: string
  projectId?: string
  issueKey: string
  summary?: string
  description?: string
  priority?: string
  assignee?: string
  labels?: string[]
  components?: string[]
  duedate?: string
  fixVersions?: string[]
  environment?: string
  customFieldId?: string
  customFieldValue?: string
  notifyUsers?: boolean
  cloudId?: string
}

export interface JiraUpdateResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    summary: string
    success: boolean
  }
}

export interface JiraWriteParams {
  accessToken: string
  domain: string
  projectId: string
  summary: string
  description?: string
  priority?: string
  assignee?: string
  cloudId?: string
  issueType: string
  parent?: { key: string }
  labels?: string[]
  components?: string[]
  duedate?: string
  fixVersions?: string[]
  reporter?: string
  environment?: string
  customFieldId?: string
  customFieldValue?: string
}

export interface JiraWriteResponse extends ToolResponse {
  output: {
    ts: string
    id: string
    issueKey: string
    self: string
    summary: string
    success: boolean
    url: string
    assigneeId: string | null
  }
}

export interface JiraIssue {
  key: string
  summary: string
  status: string
  priority?: string
  assignee?: string
  updated: string
}

export interface JiraProject {
  id: string
  key: string
  name: string
  url: string
}

export interface JiraCloudResource {
  id: string
  url: string
  name: string
  scopes: string[]
  avatarUrl: string
}

export interface JiraDeleteIssueParams {
  accessToken: string
  domain: string
  issueKey: string
  cloudId?: string
  deleteSubtasks?: boolean
}

export interface JiraDeleteIssueResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    success: boolean
  }
}

export interface JiraAssignIssueParams {
  accessToken: string
  domain: string
  issueKey: string
  accountId: string
  cloudId?: string
}

export interface JiraAssignIssueResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    assigneeId: string
    success: boolean
  }
}

export interface JiraTransitionIssueParams {
  accessToken: string
  domain: string
  issueKey: string
  transitionId: string
  comment?: string
  resolution?: string
  cloudId?: string
}

export interface JiraTransitionIssueResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    transitionId: string
    transitionName: string | null
    toStatus: { id: string; name: string } | null
    success: boolean
  }
}

export interface JiraSearchIssuesParams {
  accessToken: string
  domain: string
  jql: string
  nextPageToken?: string
  maxResults?: number
  fields?: string[]
  cloudId?: string
}

export interface JiraSearchIssuesResponse extends ToolResponse {
  output: {
    ts: string
    issues: Array<{
      id: string
      key: string
      self: string
      summary: string
      description: string | null
      status: {
        id: string
        name: string
        statusCategory?: { id: number; key: string; name: string; colorName: string }
      }
      issuetype: { id: string; name: string; subtask: boolean }
      project: { id: string; key: string; name: string }
      priority: { id: string; name: string } | null
      assignee: { accountId: string; displayName: string } | null
      reporter: { accountId: string; displayName: string } | null
      labels: string[]
      components: Array<{ id: string; name: string }>
      resolution: { id: string; name: string } | null
      duedate: string | null
      created: string
      updated: string
    }>
    nextPageToken: string | null
    isLast: boolean
    total: number | null
  }
}

export interface JiraAddCommentParams {
  accessToken: string
  domain: string
  issueKey: string
  body: string
  visibility?: { type: string; value: string }
  cloudId?: string
}

export interface JiraAddCommentResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    commentId: string
    body: string
    author: { accountId: string; displayName: string }
    created: string
    updated: string
    success: boolean
  }
}

export interface JiraGetCommentsParams {
  accessToken: string
  domain: string
  issueKey: string
  startAt?: number
  maxResults?: number
  orderBy?: string
  cloudId?: string
}

export interface JiraGetCommentsResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    total: number
    startAt: number
    maxResults: number
    comments: Array<{
      id: string
      body: string
      author: { accountId: string; displayName: string; active?: boolean }
      updateAuthor: { accountId: string; displayName: string } | null
      created: string
      updated: string
      visibility: { type: string; value: string } | null
    }>
  }
}

export interface JiraUpdateCommentParams {
  accessToken: string
  domain: string
  issueKey: string
  commentId: string
  body: string
  visibility?: { type: string; value: string }
  cloudId?: string
}

export interface JiraUpdateCommentResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    commentId: string
    body: string
    author: { accountId: string; displayName: string }
    created: string
    updated: string
    success: boolean
  }
}

export interface JiraDeleteCommentParams {
  accessToken: string
  domain: string
  issueKey: string
  commentId: string
  cloudId?: string
}

export interface JiraDeleteCommentResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    commentId: string
    success: boolean
  }
}

export interface JiraGetAttachmentsParams {
  accessToken: string
  domain: string
  issueKey: string
  cloudId?: string
}

export interface JiraGetAttachmentsResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    attachments: Array<{
      id: string
      filename: string
      mimeType: string
      size: number
      content: string
      thumbnail: string | null
      author: { accountId: string; displayName: string } | null
      created: string
    }>
  }
}

export interface JiraDeleteAttachmentParams {
  accessToken: string
  domain: string
  attachmentId: string
  cloudId?: string
}

export interface JiraDeleteAttachmentResponse extends ToolResponse {
  output: {
    ts: string
    attachmentId: string
    success: boolean
  }
}

export interface JiraAddAttachmentParams {
  accessToken: string
  domain: string
  issueKey: string
  files: UserFile[]
  cloudId?: string
}

export interface JiraAddAttachmentResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    attachments: Array<{
      id: string
      filename: string
      mimeType: string
      size: number
      content: string
    }>
    attachmentIds: string[]
    files: Array<{
      name: string
      mimeType: string
      size: number
    }>
  }
}

export interface JiraAddWorklogParams {
  accessToken: string
  domain: string
  issueKey: string
  timeSpentSeconds: number
  comment?: string
  started?: string
  visibility?: { type: string; value: string }
  cloudId?: string
}

export interface JiraAddWorklogResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    worklogId: string
    timeSpent: string
    timeSpentSeconds: number
    author: { accountId: string; displayName: string }
    started: string
    created: string
    success: boolean
  }
}

export interface JiraGetWorklogsParams {
  accessToken: string
  domain: string
  issueKey: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraGetWorklogsResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    total: number
    startAt: number
    maxResults: number
    worklogs: Array<{
      id: string
      author: { accountId: string; displayName: string }
      updateAuthor: { accountId: string; displayName: string } | null
      comment: string | null
      started: string
      timeSpent: string
      timeSpentSeconds: number
      created: string
      updated: string
    }>
  }
}

export interface JiraUpdateWorklogParams {
  accessToken: string
  domain: string
  issueKey: string
  worklogId: string
  timeSpentSeconds?: number
  comment?: string
  started?: string
  visibility?: { type: string; value: string }
  cloudId?: string
}

export interface JiraUpdateWorklogResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    worklogId: string
    timeSpent: string | null
    timeSpentSeconds: number | null
    success: boolean
  }
}

export interface JiraDeleteWorklogParams {
  accessToken: string
  domain: string
  issueKey: string
  worklogId: string
  cloudId?: string
}

export interface JiraDeleteWorklogResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    worklogId: string
    success: boolean
  }
}

export interface JiraCreateIssueLinkParams {
  accessToken: string
  domain: string
  inwardIssueKey: string
  outwardIssueKey: string
  linkType: string
  comment?: string
  cloudId?: string
}

export interface JiraCreateIssueLinkResponse extends ToolResponse {
  output: {
    ts: string
    inwardIssue: string
    outwardIssue: string
    linkType: string
    linkId: string | null
    success: boolean
  }
}

export interface JiraDeleteIssueLinkParams {
  accessToken: string
  domain: string
  linkId: string
  cloudId?: string
}

export interface JiraDeleteIssueLinkResponse extends ToolResponse {
  output: {
    ts: string
    linkId: string
    success: boolean
  }
}

export interface JiraAddWatcherParams {
  accessToken: string
  domain: string
  issueKey: string
  accountId: string
  cloudId?: string
}

export interface JiraAddWatcherResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    watcherAccountId: string
    success: boolean
  }
}

export interface JiraRemoveWatcherParams {
  accessToken: string
  domain: string
  issueKey: string
  accountId: string
  cloudId?: string
}

export interface JiraRemoveWatcherResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    watcherAccountId: string
    success: boolean
  }
}

export interface JiraGetUsersParams {
  accessToken: string
  domain: string
  accountId?: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraGetUsersResponse extends ToolResponse {
  output: {
    ts: string
    users: Array<{
      accountId: string
      accountType?: string
      active: boolean
      displayName: string
      emailAddress?: string
      avatarUrl?: string
      timeZone?: string
    }>
    total: number
    startAt: number
    maxResults: number
  }
}

export type JiraResponse =
  | JiraRetrieveResponse
  | JiraUpdateResponse
  | JiraWriteResponse
  | JiraRetrieveResponseBulk
  | JiraDeleteIssueResponse
  | JiraAssignIssueResponse
  | JiraTransitionIssueResponse
  | JiraSearchIssuesResponse
  | JiraAddCommentResponse
  | JiraGetCommentsResponse
  | JiraUpdateCommentResponse
  | JiraDeleteCommentResponse
  | JiraGetAttachmentsResponse
  | JiraAddAttachmentResponse
  | JiraDeleteAttachmentResponse
  | JiraAddWorklogResponse
  | JiraGetWorklogsResponse
  | JiraUpdateWorklogResponse
  | JiraDeleteWorklogResponse
  | JiraCreateIssueLinkResponse
  | JiraDeleteIssueLinkResponse
  | JiraAddWatcherResponse
  | JiraRemoveWatcherResponse
  | JiraGetUsersResponse
