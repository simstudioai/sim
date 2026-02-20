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
  authorName: { type: 'string', description: 'Comment author display name' },
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
  authorName: { type: 'string', description: 'Attachment author display name' },
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
  authorName: { type: 'string', description: 'Worklog author display name' },
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
 * Board object properties from Jira Agile REST API.
 * Based on GET /rest/agile/1.0/board response.
 */
export const BOARD_ITEM_PROPERTIES = {
  id: { type: 'number', description: 'Board ID' },
  name: { type: 'string', description: 'Board name' },
  type: { type: 'string', description: 'Board type (scrum, kanban, simple)' },
  self: { type: 'string', description: 'REST API URL for this board' },
} as const satisfies Record<string, OutputProperty>

/**
 * Sprint object properties from Jira Agile REST API.
 * Based on GET /rest/agile/1.0/sprint response.
 */
export const SPRINT_ITEM_PROPERTIES = {
  id: { type: 'number', description: 'Sprint ID' },
  name: { type: 'string', description: 'Sprint name' },
  state: { type: 'string', description: 'Sprint state (active, closed, future)' },
  startDate: { type: 'string', description: 'Sprint start date (ISO 8601)', optional: true },
  endDate: { type: 'string', description: 'Sprint end date (ISO 8601)', optional: true },
  completeDate: {
    type: 'string',
    description: 'Sprint completion date (ISO 8601)',
    optional: true,
  },
  goal: { type: 'string', description: 'Sprint goal', optional: true },
  boardId: { type: 'number', description: 'Board ID the sprint belongs to', optional: true },
  self: { type: 'string', description: 'REST API URL for this sprint' },
} as const satisfies Record<string, OutputProperty>

/**
 * Detailed project properties for project list/get endpoints.
 * Based on GET /rest/api/3/project/search and GET /rest/api/3/project/{id} response.
 */
export const PROJECT_DETAIL_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Project ID' },
  key: { type: 'string', description: 'Project key (e.g., PROJ)' },
  name: { type: 'string', description: 'Project name' },
  description: { type: 'string', description: 'Project description', optional: true },
  projectTypeKey: {
    type: 'string',
    description: 'Project type key (e.g., software, business)',
    optional: true,
  },
  style: { type: 'string', description: 'Project style (classic, next-gen)', optional: true },
  simplified: {
    type: 'boolean',
    description: 'Whether the project is simplified (team-managed)',
    optional: true,
  },
  self: { type: 'string', description: 'REST API URL for this project' },
  url: { type: 'string', description: 'URL to the project in Jira', optional: true },
  lead: {
    type: 'object',
    description: 'Project lead',
    properties: USER_OUTPUT_PROPERTIES,
    optional: true,
  },
  avatarUrl: { type: 'string', description: 'Project avatar URL', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Detailed component properties for component CRUD endpoints.
 * Based on GET /rest/api/3/component/{id} response.
 */
export const COMPONENT_DETAIL_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Component ID' },
  name: { type: 'string', description: 'Component name' },
  description: { type: 'string', description: 'Component description', optional: true },
  lead: {
    type: 'object',
    description: 'Component lead',
    properties: USER_OUTPUT_PROPERTIES,
    optional: true,
  },
  assigneeType: {
    type: 'string',
    description:
      'Default assignee type (PROJECT_DEFAULT, COMPONENT_LEAD, PROJECT_LEAD, UNASSIGNED)',
    optional: true,
  },
  project: { type: 'string', description: 'Project key', optional: true },
  projectId: { type: 'number', description: 'Project ID', optional: true },
  self: { type: 'string', description: 'REST API URL for this component' },
} as const satisfies Record<string, OutputProperty>

/**
 * Detailed version properties for version CRUD endpoints.
 * Based on GET /rest/api/3/version/{id} response.
 */
export const VERSION_DETAIL_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Version ID' },
  name: { type: 'string', description: 'Version name' },
  description: { type: 'string', description: 'Version description', optional: true },
  released: { type: 'boolean', description: 'Whether the version is released' },
  archived: { type: 'boolean', description: 'Whether the version is archived' },
  startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)', optional: true },
  releaseDate: { type: 'string', description: 'Release date (YYYY-MM-DD)', optional: true },
  overdue: { type: 'boolean', description: 'Whether the version is overdue', optional: true },
  projectId: { type: 'number', description: 'Project ID' },
  self: { type: 'string', description: 'REST API URL for this version' },
} as const satisfies Record<string, OutputProperty>

/**
 * Changelog item properties from Jira API v3.
 * Based on GET /rest/api/3/issue/{issueIdOrKey}/changelog response.
 */
export const CHANGELOG_ITEM_PROPERTIES = {
  id: { type: 'string', description: 'Changelog entry ID' },
  author: {
    type: 'object',
    description: 'Author of the change',
    properties: USER_OUTPUT_PROPERTIES,
    optional: true,
  },
  created: { type: 'string', description: 'ISO 8601 timestamp of the change' },
  items: {
    type: 'array',
    description: 'Changed fields',
    items: {
      type: 'object',
      properties: {
        field: { type: 'string', description: 'Field name that changed' },
        fieldtype: { type: 'string', description: 'Field type' },
        from: { type: 'string', description: 'Previous value ID', optional: true },
        fromString: {
          type: 'string',
          description: 'Previous value display string',
          optional: true,
        },
        to: { type: 'string', description: 'New value ID', optional: true },
        toString: { type: 'string', description: 'New value display string', optional: true },
      },
    },
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
  statusName: {
    type: 'string',
    description: 'Issue status name (e.g., Open, In Progress, Done)',
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
  assigneeName: {
    type: 'string',
    description: 'Assignee display name or account ID',
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
  statusName: {
    type: 'string',
    description: 'Issue status name (e.g., Open, In Progress, Done)',
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
  assigneeName: {
    type: 'string',
    description: 'Assignee display name or account ID',
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

export interface JiraRetrieveParams {
  accessToken: string
  issueKey: string
  domain: string
  includeAttachments?: boolean
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
    statusName: string
    assignee: {
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
      accountType?: string
      timeZone?: string
    } | null
    assigneeName: string | null
    reporter: {
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
      accountType?: string
      timeZone?: string
    } | null
    creator: {
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
      accountType?: string
      timeZone?: string
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
      author: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      authorName: string
      updateAuthor?: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      created: string
      updated: string
      visibility: { type: string; value: string } | null
    }>
    worklogs: Array<{
      id: string
      author: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      authorName: string
      updateAuthor?: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
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
      author: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      authorName: string
      created: string
    }>
    issue: Record<string, unknown>
    files?: Array<{ name: string; mimeType: string; data: string; size: number }>
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
        description?: string
        statusCategory?: { id: number; key: string; name: string; colorName: string }
      }
      statusName: string
      issuetype: {
        id: string
        name: string
        description?: string
        subtask: boolean
        iconUrl?: string
      }
      project: { id: string; key: string; name: string; projectTypeKey?: string }
      priority: { id: string; name: string; iconUrl?: string } | null
      assignee: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      assigneeName: string | null
      reporter: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      labels: string[]
      components: Array<{ id: string; name: string; description?: string }>
      resolution: { id: string; name: string; description?: string } | null
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
      author: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      authorName: string
      updateAuthor: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
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
  includeAttachments?: boolean
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
      authorName: string
      created: string
    }>
    files?: Array<{ name: string; mimeType: string; data: string; size: number }>
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
    files: UserFile[]
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
      authorName: string
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
    comment: string | null
    author: {
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
      accountType?: string
      timeZone?: string
    } | null
    updateAuthor: {
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
      accountType?: string
      timeZone?: string
    } | null
    started: string | null
    created: string | null
    updated: string | null
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
      avatarUrls?: Record<string, string> | null
      timeZone?: string
      self?: string | null
    }>
    total: number
    startAt: number
    maxResults: number
  }
}

export interface JiraListProjectsParams {
  accessToken: string
  domain: string
  query?: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraListProjectsResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    startAt: number
    maxResults: number
    isLast: boolean
    projects: Array<{
      id: string
      key: string
      name: string
      description: string | null
      projectTypeKey: string | null
      style: string | null
      simplified: boolean | null
      self: string
      url: string | null
      lead: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      avatarUrl: string | null
    }>
  }
}

export interface JiraGetProjectParams {
  accessToken: string
  domain: string
  projectKeyOrId: string
  cloudId?: string
}

export interface JiraGetProjectResponse extends ToolResponse {
  output: {
    ts: string
    id: string
    key: string
    name: string
    description: string | null
    projectTypeKey: string | null
    style: string | null
    simplified: boolean | null
    self: string
    url: string | null
    lead: {
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
      accountType?: string
      timeZone?: string
    } | null
    avatarUrl: string | null
  }
}

export interface JiraListBoardsParams {
  accessToken: string
  domain: string
  projectKeyOrId?: string
  type?: string
  name?: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraListBoardsResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    startAt: number
    maxResults: number
    isLast: boolean
    boards: Array<{
      id: number
      name: string
      type: string
      self: string
    }>
  }
}

export interface JiraGetBoardSprintsParams {
  accessToken: string
  domain: string
  boardId: number
  state?: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraGetBoardSprintsResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    startAt: number
    maxResults: number
    isLast: boolean
    sprints: Array<{
      id: number
      name: string
      state: string
      startDate: string | null
      endDate: string | null
      completeDate: string | null
      goal: string | null
      boardId: number | null
      self: string
    }>
  }
}

export interface JiraGetSprintParams {
  accessToken: string
  domain: string
  sprintId: number
  cloudId?: string
}

export interface JiraGetSprintResponse extends ToolResponse {
  output: {
    ts: string
    id: number
    name: string
    state: string
    startDate: string | null
    endDate: string | null
    completeDate: string | null
    goal: string | null
    boardId: number | null
    self: string
  }
}

export interface JiraCreateSprintParams {
  accessToken: string
  domain: string
  name: string
  boardId: number
  goal?: string
  startDate?: string
  endDate?: string
  cloudId?: string
}

export interface JiraCreateSprintResponse extends ToolResponse {
  output: {
    ts: string
    id: number
    name: string
    state: string
    startDate: string | null
    endDate: string | null
    completeDate: string | null
    goal: string | null
    boardId: number | null
    self: string
    success: boolean
  }
}

export interface JiraUpdateSprintParams {
  accessToken: string
  domain: string
  sprintId: number
  name?: string
  goal?: string
  state?: string
  startDate?: string
  endDate?: string
  completeDate?: string
  cloudId?: string
}

export interface JiraUpdateSprintResponse extends ToolResponse {
  output: {
    ts: string
    id: number
    name: string
    state: string
    startDate: string | null
    endDate: string | null
    completeDate: string | null
    goal: string | null
    boardId: number | null
    self: string
    success: boolean
  }
}

export interface JiraDeleteSprintParams {
  accessToken: string
  domain: string
  sprintId: number
  cloudId?: string
}

export interface JiraDeleteSprintResponse extends ToolResponse {
  output: {
    ts: string
    sprintId: number
    success: boolean
  }
}

export interface JiraGetSprintIssuesParams {
  accessToken: string
  domain: string
  sprintId: number
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraGetSprintIssuesResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    startAt: number
    maxResults: number
    issues: Array<{
      id: string
      key: string
      self: string
      summary: string
      description: string | null
      status: {
        id: string
        name: string
        description?: string
        statusCategory?: { id: number; key: string; name: string; colorName: string }
      }
      statusName: string
      issuetype: {
        id: string
        name: string
        description?: string
        subtask: boolean
        iconUrl?: string
      }
      project: { id: string; key: string; name: string; projectTypeKey?: string }
      priority: { id: string; name: string; iconUrl?: string } | null
      assignee: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      assigneeName: string | null
      reporter: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      labels: string[]
      components: Array<{ id: string; name: string; description?: string }>
      resolution: { id: string; name: string; description?: string } | null
      duedate: string | null
      created: string
      updated: string
    }>
  }
}

export interface JiraMoveIssuesToSprintParams {
  accessToken: string
  domain: string
  sprintId: number
  issueKeys: string[]
  cloudId?: string
}

export interface JiraMoveIssuesToSprintResponse extends ToolResponse {
  output: {
    ts: string
    sprintId: number
    issueKeys: string[]
    issueCount: number
    success: boolean
  }
}

export interface JiraMoveToBacklogParams {
  accessToken: string
  domain: string
  issueKeys: string[]
  cloudId?: string
}

export interface JiraMoveToBacklogResponse extends ToolResponse {
  output: {
    ts: string
    issueKeys: string[]
    issueCount: number
    success: boolean
  }
}

export interface JiraGetIssueTypesParams {
  accessToken: string
  domain: string
  projectId?: string
  cloudId?: string
}

export interface JiraGetIssueTypesResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    issueTypes: Array<{
      id: string
      name: string
      description: string | null
      subtask: boolean
      iconUrl: string | null
    }>
  }
}

export interface JiraGetPrioritiesParams {
  accessToken: string
  domain: string
  cloudId?: string
}

export interface JiraGetPrioritiesResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    priorities: Array<{
      id: string
      name: string
      iconUrl: string | null
    }>
  }
}

export interface JiraGetStatusesParams {
  accessToken: string
  domain: string
  projectId?: string
  cloudId?: string
}

export interface JiraGetStatusesResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    statuses: Array<{
      id: string
      name: string
      description: string | null
      statusCategory: {
        id: number
        key: string
        name: string
        colorName: string
      } | null
    }>
  }
}

export interface JiraGetLabelsParams {
  accessToken: string
  domain: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraGetLabelsResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    maxResults: number
    isLast: boolean
    labels: string[]
  }
}

export interface JiraGetWatchersParams {
  accessToken: string
  domain: string
  issueKey: string
  cloudId?: string
}

export interface JiraGetWatchersResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    watchCount: number
    isWatching: boolean
    watchers: Array<{
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
      accountType?: string
      timeZone?: string
    }>
  }
}

export interface JiraSearchUsersParams {
  accessToken: string
  domain: string
  query?: string
  projectKey?: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraSearchUsersResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    users: Array<{
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
      accountType?: string
      timeZone?: string
    }>
  }
}

export interface JiraGetTransitionsParams {
  accessToken: string
  domain: string
  issueKey: string
  cloudId?: string
}

export interface JiraGetTransitionsResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    total: number
    transitions: Array<{
      id: string
      name: string
      hasScreen: boolean | null
      isGlobal: boolean | null
      isConditional: boolean | null
      to: {
        id: string
        name: string
        description?: string
        statusCategory?: { id: number; key: string; name: string; colorName: string }
      } | null
    }>
  }
}

export interface JiraGetChangelogParams {
  accessToken: string
  domain: string
  issueKey: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraGetChangelogResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    total: number
    startAt: number
    maxResults: number
    changelog: Array<{
      id: string
      author: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      created: string
      items: Array<{
        field: string
        fieldtype: string
        from: string | null
        fromString: string | null
        to: string | null
        toString: string | null
      }>
    }>
  }
}

export interface JiraCreateComponentParams {
  accessToken: string
  domain: string
  name: string
  project: string
  description?: string
  leadAccountId?: string
  assigneeType?: string
  cloudId?: string
}

export interface JiraCreateComponentResponse extends ToolResponse {
  output: {
    ts: string
    id: string
    name: string
    description: string | null
    lead: {
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
      accountType?: string
      timeZone?: string
    } | null
    assigneeType: string | null
    project: string | null
    projectId: number | null
    self: string
    success: boolean
  }
}

export interface JiraUpdateComponentParams {
  accessToken: string
  domain: string
  componentId: string
  name?: string
  description?: string
  leadAccountId?: string
  assigneeType?: string
  cloudId?: string
}

export interface JiraUpdateComponentResponse extends ToolResponse {
  output: {
    ts: string
    id: string
    name: string
    description: string | null
    lead: {
      accountId: string
      displayName: string
      active?: boolean
      emailAddress?: string
      avatarUrl?: string
      accountType?: string
      timeZone?: string
    } | null
    assigneeType: string | null
    project: string | null
    projectId: number | null
    self: string
    success: boolean
  }
}

export interface JiraDeleteComponentParams {
  accessToken: string
  domain: string
  componentId: string
  moveIssuesTo?: string
  cloudId?: string
}

export interface JiraDeleteComponentResponse extends ToolResponse {
  output: {
    ts: string
    componentId: string
    success: boolean
  }
}

export interface JiraCreateVersionParams {
  accessToken: string
  domain: string
  name: string
  projectId: string
  description?: string
  startDate?: string
  releaseDate?: string
  released?: boolean
  archived?: boolean
  cloudId?: string
}

export interface JiraCreateVersionResponse extends ToolResponse {
  output: {
    ts: string
    id: string
    name: string
    description: string | null
    released: boolean
    archived: boolean
    startDate: string | null
    releaseDate: string | null
    overdue: boolean | null
    projectId: number | null
    self: string
    success: boolean
  }
}

export interface JiraUpdateVersionParams {
  accessToken: string
  domain: string
  versionId: string
  name?: string
  description?: string
  startDate?: string
  releaseDate?: string
  released?: boolean
  archived?: boolean
  cloudId?: string
}

export interface JiraUpdateVersionResponse extends ToolResponse {
  output: {
    ts: string
    id: string
    name: string
    description: string | null
    released: boolean
    archived: boolean
    startDate: string | null
    releaseDate: string | null
    overdue: boolean | null
    projectId: number | null
    self: string
    success: boolean
  }
}

export interface JiraDeleteVersionParams {
  accessToken: string
  domain: string
  versionId: string
  moveFixIssuesTo?: string
  moveAffectedIssuesTo?: string
  cloudId?: string
}

export interface JiraDeleteVersionResponse extends ToolResponse {
  output: {
    ts: string
    versionId: string
    success: boolean
  }
}

export interface JiraGetMyselfParams {
  accessToken: string
  domain: string
  cloudId?: string
}

export interface JiraGetMyselfResponse extends ToolResponse {
  output: {
    ts: string
    accountId: string
    displayName: string
    active?: boolean
    emailAddress?: string
    avatarUrl?: string
    accountType?: string
    timeZone?: string
    locale: string | null
  }
}

export interface JiraGetFieldsParams {
  accessToken: string
  domain: string
  cloudId?: string
}

export interface JiraGetFieldsResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    fields: Array<{
      id: string
      key: string
      name: string
      custom: boolean
      orderable: boolean
      navigable: boolean
      searchable: boolean
      clauseNames: string[]
      schema: {
        type: string
        system: string | null
        custom: string | null
        customId: number | null
      } | null
    }>
  }
}

export interface JiraGetLinkTypesParams {
  accessToken: string
  domain: string
  cloudId?: string
}

export interface JiraGetLinkTypesResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    linkTypes: Array<{
      id: string
      name: string
      inward: string
      outward: string
      self: string
    }>
  }
}

export interface JiraGetResolutionsParams {
  accessToken: string
  domain: string
  cloudId?: string
}

export interface JiraGetResolutionsResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    resolutions: Array<{
      id: string
      name: string
      description: string | null
    }>
  }
}

export interface JiraGetProjectComponentsParams {
  accessToken: string
  domain: string
  projectKeyOrId: string
  cloudId?: string
}

export interface JiraGetProjectComponentsResponse extends ToolResponse {
  output: {
    ts: string
    projectKeyOrId: string
    total: number
    components: Array<{
      id: string
      name: string
      description: string | null
      lead: {
        accountId: string
        displayName: string
        active?: boolean
        emailAddress?: string
        avatarUrl?: string
        accountType?: string
        timeZone?: string
      } | null
      assigneeType: string | null
      project: string | null
      projectId: number | null
      self: string
    }>
  }
}

export interface JiraGetProjectVersionsParams {
  accessToken: string
  domain: string
  projectKeyOrId: string
  cloudId?: string
}

export interface JiraGetProjectVersionsResponse extends ToolResponse {
  output: {
    ts: string
    projectKeyOrId: string
    total: number
    versions: Array<{
      id: string
      name: string
      description: string | null
      released: boolean
      archived: boolean
      startDate: string | null
      releaseDate: string | null
      overdue: boolean | null
      projectId: number | null
      self: string
    }>
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
  | JiraListProjectsResponse
  | JiraGetProjectResponse
  | JiraListBoardsResponse
  | JiraGetBoardSprintsResponse
  | JiraGetSprintResponse
  | JiraCreateSprintResponse
  | JiraUpdateSprintResponse
  | JiraDeleteSprintResponse
  | JiraGetSprintIssuesResponse
  | JiraMoveIssuesToSprintResponse
  | JiraMoveToBacklogResponse
  | JiraGetIssueTypesResponse
  | JiraGetPrioritiesResponse
  | JiraGetStatusesResponse
  | JiraGetLabelsResponse
  | JiraGetWatchersResponse
  | JiraSearchUsersResponse
  | JiraGetTransitionsResponse
  | JiraGetChangelogResponse
  | JiraCreateComponentResponse
  | JiraUpdateComponentResponse
  | JiraDeleteComponentResponse
  | JiraCreateVersionResponse
  | JiraUpdateVersionResponse
  | JiraDeleteVersionResponse
  | JiraGetMyselfResponse
  | JiraGetFieldsResponse
  | JiraGetLinkTypesResponse
  | JiraGetResolutionsResponse
  | JiraGetProjectComponentsResponse
  | JiraGetProjectVersionsResponse
