import type { OutputProperty, ToolFileData, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for GitHub API responses.
 * These are reusable across all GitHub tools to ensure consistency.
 */

/**
 * Output definition for GitHub user objects
 */
export const USER_OUTPUT_PROPERTIES = {
  login: { type: 'string', description: 'GitHub username' },
  id: { type: 'number', description: 'User ID' },
  avatar_url: { type: 'string', description: 'Avatar image URL' },
  html_url: { type: 'string', description: 'Profile URL' },
  type: { type: 'string', description: 'Account type (User or Organization)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete user object output definition
 */
export const USER_OUTPUT = {
  type: 'object',
  description: 'GitHub user object',
  properties: USER_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Extended user output properties for V2 tools (includes additional API fields)
 */
export const USER_FULL_OUTPUT_PROPERTIES = {
  login: { type: 'string', description: 'GitHub username' },
  id: { type: 'number', description: 'User ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  avatar_url: { type: 'string', description: 'Avatar image URL' },
  url: { type: 'string', description: 'API URL' },
  html_url: { type: 'string', description: 'Profile page URL' },
  type: { type: 'string', description: 'User or Organization' },
  site_admin: { type: 'boolean', description: 'GitHub staff indicator' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete user object output definition for V2 tools
 */
export const USER_FULL_OUTPUT = {
  type: 'object',
  description: 'GitHub user object',
  optional: true,
  properties: USER_FULL_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for Git author/committer objects (name, email, date)
 */
export const GIT_ACTOR_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Name' },
  email: { type: 'string', description: 'Email address' },
  date: { type: 'string', description: 'Timestamp (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Git actor output definition
 */
export const GIT_ACTOR_OUTPUT = {
  type: 'object',
  description: 'Git actor (author/committer)',
  properties: GIT_ACTOR_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for commit tree objects
 */
export const COMMIT_TREE_OUTPUT_PROPERTIES = {
  sha: { type: 'string', description: 'Tree SHA' },
  url: { type: 'string', description: 'Tree API URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete commit tree output definition
 */
export const COMMIT_TREE_OUTPUT = {
  type: 'object',
  description: 'Tree object',
  properties: COMMIT_TREE_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for commit verification objects
 */
export const COMMIT_VERIFICATION_OUTPUT_PROPERTIES = {
  verified: { type: 'boolean', description: 'Whether signature is verified' },
  reason: { type: 'string', description: 'Verification reason' },
  signature: { type: 'string', description: 'GPG signature', optional: true },
  payload: { type: 'string', description: 'Signed payload', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete commit verification output definition
 */
export const COMMIT_VERIFICATION_OUTPUT = {
  type: 'object',
  description: 'Signature verification',
  properties: COMMIT_VERIFICATION_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for core commit data (the 'commit' field in GitHub API responses)
 */
export const COMMIT_DATA_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'Commit API URL' },
  message: { type: 'string', description: 'Commit message' },
  comment_count: { type: 'number', description: 'Number of comments' },
  author: GIT_ACTOR_OUTPUT,
  committer: GIT_ACTOR_OUTPUT,
  tree: COMMIT_TREE_OUTPUT,
  verification: COMMIT_VERIFICATION_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete commit data output definition
 */
export const COMMIT_DATA_OUTPUT = {
  type: 'object',
  description: 'Core commit data',
  properties: COMMIT_DATA_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for commit stats objects
 */
export const COMMIT_STATS_OUTPUT_PROPERTIES = {
  additions: { type: 'number', description: 'Lines added' },
  deletions: { type: 'number', description: 'Lines deleted' },
  total: { type: 'number', description: 'Total changes' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete commit stats output definition
 */
export const COMMIT_STATS_OUTPUT = {
  type: 'object',
  description: 'Change statistics',
  optional: true,
  properties: COMMIT_STATS_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for commit file/diff entry objects
 */
export const COMMIT_FILE_OUTPUT_PROPERTIES = {
  sha: { type: 'string', description: 'Blob SHA', optional: true },
  filename: { type: 'string', description: 'File path' },
  status: {
    type: 'string',
    description: 'Change status (added, removed, modified, renamed, copied, changed, unchanged)',
  },
  additions: { type: 'number', description: 'Lines added' },
  deletions: { type: 'number', description: 'Lines deleted' },
  changes: { type: 'number', description: 'Total changes' },
  blob_url: { type: 'string', description: 'Blob URL' },
  raw_url: { type: 'string', description: 'Raw file URL' },
  contents_url: { type: 'string', description: 'Contents API URL' },
  patch: { type: 'string', description: 'Diff patch', optional: true },
  previous_filename: {
    type: 'string',
    description: 'Previous filename (for renames)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete commit file output definition
 */
export const COMMIT_FILE_OUTPUT = {
  type: 'object',
  description: 'Changed file (diff entry)',
  properties: COMMIT_FILE_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for parent commit references
 */
export const COMMIT_PARENT_OUTPUT_PROPERTIES = {
  sha: { type: 'string', description: 'Parent SHA' },
  url: { type: 'string', description: 'Parent API URL' },
  html_url: { type: 'string', description: 'Parent web URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete parent commit output definition
 */
export const COMMIT_PARENT_OUTPUT = {
  type: 'object',
  description: 'Parent commit reference',
  properties: COMMIT_PARENT_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for commit summary properties (common across list/search responses)
 */
export const COMMIT_SUMMARY_OUTPUT_PROPERTIES = {
  sha: { type: 'string', description: 'Commit SHA' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  html_url: { type: 'string', description: 'GitHub web URL' },
  url: { type: 'string', description: 'API URL' },
  comments_url: { type: 'string', description: 'Comments API URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for repository objects in search results
 */
export const SEARCH_REPO_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Repository ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  name: { type: 'string', description: 'Repository name' },
  full_name: { type: 'string', description: 'Full name (owner/repo)' },
  private: { type: 'boolean', description: 'Whether repository is private' },
  html_url: { type: 'string', description: 'GitHub web URL' },
  description: { type: 'string', description: 'Repository description', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search repository output definition
 */
export const SEARCH_REPO_OUTPUT = {
  type: 'object',
  description: 'Repository containing the commit',
  properties: SEARCH_REPO_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Extended repository output properties for V2 tools (full API response)
 */
export const REPO_FULL_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Repository ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  name: { type: 'string', description: 'Repository name' },
  full_name: { type: 'string', description: 'Full name (owner/repo)' },
  private: { type: 'boolean', description: 'Whether repository is private' },
  description: { type: 'string', description: 'Repository description', optional: true },
  html_url: { type: 'string', description: 'GitHub web URL' },
  url: { type: 'string', description: 'API URL' },
  fork: { type: 'boolean', description: 'Whether this is a fork' },
  created_at: { type: 'string', description: 'Creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
  pushed_at: { type: 'string', description: 'Last push timestamp', optional: true },
  size: { type: 'number', description: 'Repository size in KB' },
  stargazers_count: { type: 'number', description: 'Number of stars' },
  watchers_count: { type: 'number', description: 'Number of watchers' },
  forks_count: { type: 'number', description: 'Number of forks' },
  open_issues_count: { type: 'number', description: 'Number of open issues' },
  language: { type: 'string', description: 'Primary programming language', optional: true },
  default_branch: { type: 'string', description: 'Default branch name' },
  visibility: { type: 'string', description: 'Repository visibility' },
  archived: { type: 'boolean', description: 'Whether repository is archived' },
  disabled: { type: 'boolean', description: 'Whether repository is disabled' },
} as const satisfies Record<string, OutputProperty>

/**
 * License output properties
 */
export const LICENSE_OUTPUT_PROPERTIES = {
  key: { type: 'string', description: 'License key (e.g., mit)' },
  name: { type: 'string', description: 'License name' },
  spdx_id: { type: 'string', description: 'SPDX identifier' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete license object output definition
 */
export const LICENSE_OUTPUT = {
  type: 'object',
  description: 'License information',
  optional: true,
  properties: LICENSE_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Parent repository output properties for fork responses
 */
export const PARENT_REPO_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Repository ID' },
  full_name: { type: 'string', description: 'Full name' },
  html_url: { type: 'string', description: 'Web URL' },
  description: { type: 'string', description: 'Description', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Minimal parent owner output properties
 */
export const PARENT_OWNER_OUTPUT_PROPERTIES = {
  login: { type: 'string', description: 'Username' },
  id: { type: 'number', description: 'User ID' },
} as const satisfies Record<string, OutputProperty>

/**
 * Source repository output properties (minimal)
 */
export const SOURCE_REPO_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Repository ID' },
  full_name: { type: 'string', description: 'Full name' },
  html_url: { type: 'string', description: 'Web URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for branch reference objects (head/base in PRs)
 */
export const BRANCH_REF_OUTPUT_PROPERTIES = {
  label: { type: 'string', description: 'Branch label (owner:branch)' },
  ref: { type: 'string', description: 'Branch name' },
  sha: { type: 'string', description: 'Commit SHA' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete branch reference output definition
 */
export const BRANCH_REF_OUTPUT = {
  type: 'object',
  description: 'Branch reference info',
  properties: BRANCH_REF_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for commit reference in branches (sha and url)
 */
export const COMMIT_REF_OUTPUT_PROPERTIES = {
  sha: { type: 'string', description: 'Commit SHA' },
  url: { type: 'string', description: 'Commit API URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete commit reference output definition
 */
export const COMMIT_REF_OUTPUT = {
  type: 'object',
  description: 'Commit reference info',
  properties: COMMIT_REF_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for branch objects
 */
export const BRANCH_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Branch name' },
  commit: COMMIT_REF_OUTPUT,
  protected: { type: 'boolean', description: 'Whether branch is protected' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete branch output definition
 */
export const BRANCH_OUTPUT = {
  type: 'object',
  description: 'Branch object',
  properties: BRANCH_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for git reference objects (created branches)
 */
export const GIT_REF_OUTPUT_PROPERTIES = {
  ref: { type: 'string', description: 'Full reference name (refs/heads/branch)' },
  node_id: { type: 'string', description: 'Git ref node ID' },
  url: { type: 'string', description: 'API URL for the reference' },
  object: { type: 'json', description: 'Git object with type and sha' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete git reference output definition
 */
export const GIT_REF_OUTPUT = {
  type: 'object',
  description: 'Git reference object',
  properties: GIT_REF_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for branch protection settings
 */
export const BRANCH_PROTECTION_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'Protection settings URL' },
  required_status_checks: {
    type: 'json',
    description: 'Status check requirements',
    optional: true,
  },
  enforce_admins: { type: 'json', description: 'Admin enforcement settings' },
  required_pull_request_reviews: {
    type: 'json',
    description: 'PR review requirements',
    optional: true,
  },
  restrictions: { type: 'json', description: 'Push restrictions', optional: true },
  required_linear_history: {
    type: 'json',
    description: 'Linear history requirement',
    optional: true,
  },
  allow_force_pushes: { type: 'json', description: 'Force push settings', optional: true },
  allow_deletions: { type: 'json', description: 'Deletion settings', optional: true },
  block_creations: { type: 'json', description: 'Creation blocking settings', optional: true },
  required_conversation_resolution: {
    type: 'json',
    description: 'Conversation resolution requirement',
    optional: true,
  },
  required_signatures: { type: 'json', description: 'Signature requirements', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete branch protection output definition
 */
export const BRANCH_PROTECTION_OUTPUT = {
  type: 'object',
  description: 'Branch protection configuration',
  properties: BRANCH_PROTECTION_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for delete branch response
 */
export const DELETE_BRANCH_OUTPUT_PROPERTIES = {
  deleted: { type: 'boolean', description: 'Whether the branch was deleted' },
  branch: { type: 'string', description: 'Name of the deleted branch' },
} as const satisfies Record<string, OutputProperty>

/**
 * Extended output definition for milestone creator user objects (V2 tools)
 */
export const MILESTONE_CREATOR_OUTPUT_PROPERTIES = {
  login: { type: 'string', description: 'Username' },
  id: { type: 'number', description: 'User ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  avatar_url: { type: 'string', description: 'Avatar image URL' },
  url: { type: 'string', description: 'API URL' },
  html_url: { type: 'string', description: 'Profile page URL' },
  type: { type: 'string', description: 'User or Organization' },
  site_admin: { type: 'boolean', description: 'GitHub staff indicator' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete milestone creator output definition (V2 tools)
 */
export const MILESTONE_CREATOR_OUTPUT = {
  type: 'object',
  description: 'Milestone creator',
  optional: true,
  properties: MILESTONE_CREATOR_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Extended output definition for V2 milestone objects (full API response)
 */
export const MILESTONE_V2_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Milestone ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  number: { type: 'number', description: 'Milestone number' },
  title: { type: 'string', description: 'Milestone title' },
  description: { type: 'string', description: 'Milestone description', optional: true },
  state: { type: 'string', description: 'State (open or closed)' },
  url: { type: 'string', description: 'API URL' },
  html_url: { type: 'string', description: 'GitHub web URL' },
  labels_url: { type: 'string', description: 'Labels API URL' },
  due_on: { type: 'string', description: 'Due date (ISO 8601)', optional: true },
  open_issues: { type: 'number', description: 'Number of open issues' },
  closed_issues: { type: 'number', description: 'Number of closed issues' },
  created_at: { type: 'string', description: 'Creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
  closed_at: { type: 'string', description: 'Close timestamp', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for GitHub Project V2 objects
 */
export const PROJECT_V2_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Project node ID' },
  title: { type: 'string', description: 'Project title' },
  number: { type: 'number', description: 'Project number' },
  url: { type: 'string', description: 'Project URL' },
  closed: { type: 'boolean', description: 'Whether project is closed' },
  public: { type: 'boolean', description: 'Whether project is public' },
  shortDescription: { type: 'string', description: 'Short description', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Extended output definition for V2 project objects (full API response)
 */
export const PROJECT_V2_FULL_OUTPUT_PROPERTIES = {
  ...PROJECT_V2_OUTPUT_PROPERTIES,
  readme: { type: 'string', description: 'Project readme', optional: true },
  createdAt: { type: 'string', description: 'Creation timestamp' },
  updatedAt: { type: 'string', description: 'Last update timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for gist file objects
 */
export const GIST_FILE_OUTPUT_PROPERTIES = {
  filename: { type: 'string', description: 'File name' },
  type: { type: 'string', description: 'MIME type' },
  language: { type: 'string', description: 'Programming language', optional: true },
  raw_url: { type: 'string', description: 'Raw file URL' },
  size: { type: 'number', description: 'File size in bytes' },
  truncated: { type: 'boolean', description: 'Whether content is truncated' },
  content: { type: 'string', description: 'File content' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for gist owner objects (extended user info)
 */
export const GIST_OWNER_OUTPUT_PROPERTIES = {
  login: { type: 'string', description: 'Username' },
  id: { type: 'number', description: 'User ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  avatar_url: { type: 'string', description: 'Avatar image URL' },
  url: { type: 'string', description: 'API URL' },
  html_url: { type: 'string', description: 'Profile page URL' },
  type: { type: 'string', description: 'User or Organization' },
  site_admin: { type: 'boolean', description: 'GitHub staff indicator' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete gist owner object output definition
 */
export const GIST_OWNER_OUTPUT = {
  type: 'object',
  description: 'Gist owner',
  optional: true,
  properties: GIST_OWNER_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for gist objects (core properties)
 */
export const GIST_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Gist ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  url: { type: 'string', description: 'API URL' },
  html_url: { type: 'string', description: 'GitHub web URL' },
  forks_url: { type: 'string', description: 'Forks API URL' },
  commits_url: { type: 'string', description: 'Commits API URL' },
  git_pull_url: { type: 'string', description: 'Git clone URL' },
  git_push_url: { type: 'string', description: 'Git push URL' },
  description: { type: 'string', description: 'Gist description', optional: true },
  public: { type: 'boolean', description: 'Whether gist is public' },
  truncated: { type: 'boolean', description: 'Whether content is truncated' },
  comments: { type: 'number', description: 'Number of comments' },
  comments_url: { type: 'string', description: 'Comments API URL' },
  created_at: { type: 'string', description: 'Creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete gist files object output definition
 */
export const GIST_FILES_OUTPUT = {
  type: 'object',
  description: 'Files in the gist (keyed by filename)',
  properties: {
    '[filename]': {
      type: 'object',
      description: 'File object',
      properties: GIST_FILE_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies OutputProperty

/**
 * Output definition for GitHub label objects
 * @see https://docs.github.com/en/rest/issues/labels
 */
export const LABEL_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Label ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  url: { type: 'string', description: 'API URL' },
  name: { type: 'string', description: 'Label name' },
  description: { type: 'string', description: 'Label description', optional: true },
  color: { type: 'string', description: 'Hex color code (without #)' },
  default: { type: 'boolean', description: 'Whether this is a default label' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete label object output definition
 */
export const LABEL_OUTPUT = {
  type: 'object',
  description: 'GitHub label object',
  properties: LABEL_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for GitHub milestone objects
 * @see https://docs.github.com/en/rest/issues/milestones
 */
export const MILESTONE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Milestone ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  number: { type: 'number', description: 'Milestone number' },
  title: { type: 'string', description: 'Milestone title' },
  description: { type: 'string', description: 'Milestone description', optional: true },
  state: { type: 'string', description: 'State (open or closed)' },
  url: { type: 'string', description: 'API URL' },
  html_url: { type: 'string', description: 'GitHub web URL' },
  labels_url: { type: 'string', description: 'Labels API URL' },
  due_on: { type: 'string', description: 'Due date (ISO 8601)', optional: true },
  open_issues: { type: 'number', description: 'Number of open issues' },
  closed_issues: { type: 'number', description: 'Number of closed issues' },
  created_at: { type: 'string', description: 'Creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
  closed_at: { type: 'string', description: 'Close timestamp', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete milestone object output definition
 */
export const MILESTONE_OUTPUT = {
  type: 'object',
  description: 'GitHub milestone object',
  optional: true,
  properties: MILESTONE_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for GitHub issue objects (V2 tools)
 * @see https://docs.github.com/en/rest/issues/issues
 */
export const ISSUE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Issue ID' },
  number: { type: 'number', description: 'Issue number' },
  title: { type: 'string', description: 'Issue title' },
  state: { type: 'string', description: 'Issue state (open/closed)' },
  html_url: { type: 'string', description: 'GitHub web URL' },
  body: { type: 'string', description: 'Issue body/description', optional: true },
  created_at: { type: 'string', description: 'Creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
  closed_at: { type: 'string', description: 'Close timestamp', optional: true },
  state_reason: {
    type: 'string',
    description: 'State reason (completed/not_planned)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for GitHub comment objects (V2 tools)
 * @see https://docs.github.com/en/rest/issues/comments
 */
export const COMMENT_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Comment ID' },
  body: { type: 'string', description: 'Comment body' },
  html_url: { type: 'string', description: 'GitHub web URL' },
  path: { type: 'string', description: 'File path (for file comments)', optional: true },
  line: { type: 'number', description: 'Line number (for file comments)', optional: true },
  side: { type: 'string', description: 'Side (LEFT/RIGHT for diff comments)', optional: true },
  commit_id: { type: 'string', description: 'Commit SHA', optional: true },
  created_at: { type: 'string', description: 'Creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for GitHub reaction objects
 * @see https://docs.github.com/en/rest/reactions
 */
export const REACTION_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Reaction ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  content: {
    type: 'string',
    description: 'Reaction type (+1, -1, laugh, confused, heart, hooray, rocket, eyes)',
  },
  created_at: { type: 'string', description: 'Creation timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for GitHub release asset objects
 * @see https://docs.github.com/en/rest/releases/assets
 */
export const RELEASE_ASSET_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Asset ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  name: { type: 'string', description: 'Asset filename' },
  label: { type: 'string', description: 'Asset label', optional: true },
  state: { type: 'string', description: 'Asset state (uploaded/open)' },
  content_type: { type: 'string', description: 'MIME type' },
  size: { type: 'number', description: 'File size in bytes' },
  download_count: { type: 'number', description: 'Number of downloads' },
  browser_download_url: { type: 'string', description: 'Direct download URL' },
  created_at: { type: 'string', description: 'Upload timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for GitHub release objects (V2 tools)
 * @see https://docs.github.com/en/rest/releases/releases
 */
export const RELEASE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Release ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  tag_name: { type: 'string', description: 'Git tag name' },
  name: { type: 'string', description: 'Release name', optional: true },
  body: { type: 'string', description: 'Release notes (markdown)', optional: true },
  html_url: { type: 'string', description: 'GitHub web URL' },
  tarball_url: { type: 'string', description: 'Source tarball URL' },
  zipball_url: { type: 'string', description: 'Source zipball URL' },
  draft: { type: 'boolean', description: 'Whether this is a draft release' },
  prerelease: { type: 'boolean', description: 'Whether this is a prerelease' },
  target_commitish: { type: 'string', description: 'Target branch or commit SHA' },
  created_at: { type: 'string', description: 'Creation timestamp' },
  published_at: { type: 'string', description: 'Publication timestamp', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for GitHub workflow objects (V2 tools)
 * @see https://docs.github.com/en/rest/actions/workflows
 */
export const WORKFLOW_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Workflow ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  name: { type: 'string', description: 'Workflow name' },
  path: { type: 'string', description: 'Path to workflow file' },
  state: {
    type: 'string',
    description: 'Workflow state (active/disabled_manually/disabled_inactivity)',
  },
  html_url: { type: 'string', description: 'GitHub web URL' },
  badge_url: { type: 'string', description: 'Status badge URL' },
  url: { type: 'string', description: 'API URL' },
  created_at: { type: 'string', description: 'Creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
  deleted_at: { type: 'string', description: 'Deletion timestamp', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for head commit in workflow runs
 * @see https://docs.github.com/en/rest/actions/workflow-runs
 */
export const HEAD_COMMIT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Commit SHA' },
  tree_id: { type: 'string', description: 'Tree SHA' },
  message: { type: 'string', description: 'Commit message' },
  timestamp: { type: 'string', description: 'Commit timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete head commit output definition
 */
export const HEAD_COMMIT_OUTPUT = {
  type: 'object',
  description: 'Head commit information',
  optional: true,
  properties: HEAD_COMMIT_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for PR references in workflow runs
 */
export const PR_REFERENCE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Pull request ID' },
  number: { type: 'number', description: 'Pull request number' },
  url: { type: 'string', description: 'API URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete PR reference output definition
 */
export const PR_REFERENCE_OUTPUT = {
  type: 'object',
  description: 'Pull request reference',
  properties: PR_REFERENCE_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for referenced workflows in workflow runs
 */
export const REFERENCED_WORKFLOW_OUTPUT_PROPERTIES = {
  path: { type: 'string', description: 'Path to referenced workflow' },
  sha: { type: 'string', description: 'Commit SHA of referenced workflow' },
  ref: { type: 'string', description: 'Git ref of referenced workflow', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete referenced workflow output definition
 */
export const REFERENCED_WORKFLOW_OUTPUT = {
  type: 'object',
  description: 'Referenced workflow',
  properties: REFERENCED_WORKFLOW_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty

/**
 * Output definition for GitHub workflow run objects (V2 tools)
 * @see https://docs.github.com/en/rest/actions/workflow-runs
 */
export const WORKFLOW_RUN_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Workflow run ID' },
  name: { type: 'string', description: 'Workflow name', optional: true },
  head_branch: { type: 'string', description: 'Head branch name', optional: true },
  head_sha: { type: 'string', description: 'Head commit SHA' },
  run_number: { type: 'number', description: 'Run number' },
  run_attempt: { type: 'number', description: 'Run attempt number' },
  event: { type: 'string', description: 'Event that triggered the run' },
  status: { type: 'string', description: 'Run status (queued/in_progress/completed)' },
  conclusion: {
    type: 'string',
    description: 'Run conclusion (success/failure/cancelled/etc)',
    optional: true,
  },
  workflow_id: { type: 'number', description: 'Associated workflow ID' },
  html_url: { type: 'string', description: 'GitHub web URL' },
  logs_url: { type: 'string', description: 'Logs download URL' },
  jobs_url: { type: 'string', description: 'Jobs API URL' },
  artifacts_url: { type: 'string', description: 'Artifacts API URL' },
  run_started_at: { type: 'string', description: 'Run start timestamp', optional: true },
  created_at: { type: 'string', description: 'Creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for PR file objects (changed files in a PR)
 * @see https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files
 */
export const PR_FILE_OUTPUT_PROPERTIES = {
  sha: { type: 'string', description: 'Blob SHA' },
  filename: { type: 'string', description: 'File path' },
  status: {
    type: 'string',
    description: 'Change status (added/removed/modified/renamed/copied/changed/unchanged)',
  },
  additions: { type: 'number', description: 'Lines added' },
  deletions: { type: 'number', description: 'Lines deleted' },
  changes: { type: 'number', description: 'Total line changes' },
  blob_url: { type: 'string', description: 'Blob URL' },
  raw_url: { type: 'string', description: 'Raw file URL' },
  contents_url: { type: 'string', description: 'Contents API URL' },
  patch: { type: 'string', description: 'Diff patch', optional: true },
  previous_filename: {
    type: 'string',
    description: 'Previous filename (for renames)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for PR review comment objects
 * @see https://docs.github.com/en/rest/pulls/comments
 */
export const PR_COMMENT_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Comment ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  body: { type: 'string', description: 'Comment body' },
  html_url: { type: 'string', description: 'GitHub web URL' },
  path: { type: 'string', description: 'File path' },
  position: { type: 'number', description: 'Position in diff', optional: true },
  line: { type: 'number', description: 'Line number', optional: true },
  side: { type: 'string', description: 'Side (LEFT/RIGHT)', optional: true },
  commit_id: { type: 'string', description: 'Commit SHA' },
  original_commit_id: { type: 'string', description: 'Original commit SHA' },
  diff_hunk: { type: 'string', description: 'Diff hunk context' },
  created_at: { type: 'string', description: 'Creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for PR summary objects (list view)
 * @see https://docs.github.com/en/rest/pulls/pulls#list-pull-requests
 */
export const PR_SUMMARY_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Pull request ID' },
  node_id: { type: 'string', description: 'GraphQL node ID' },
  number: { type: 'number', description: 'Pull request number' },
  title: { type: 'string', description: 'PR title' },
  state: { type: 'string', description: 'PR state (open/closed)' },
  html_url: { type: 'string', description: 'GitHub web URL' },
  diff_url: { type: 'string', description: 'Diff URL' },
  body: { type: 'string', description: 'PR description', optional: true },
  locked: { type: 'boolean', description: 'Whether PR is locked' },
  draft: { type: 'boolean', description: 'Whether PR is a draft' },
  created_at: { type: 'string', description: 'Creation timestamp' },
  updated_at: { type: 'string', description: 'Last update timestamp' },
  closed_at: { type: 'string', description: 'Close timestamp', optional: true },
  merged_at: { type: 'string', description: 'Merge timestamp', optional: true },
} as const satisfies Record<string, OutputProperty>

// Base parameters shared by all GitHub operations
export interface BaseGitHubParams {
  owner: string
  repo: string
  apiKey: string
}

// PR operation parameters
export interface PROperationParams extends BaseGitHubParams {
  pullNumber: number
}

// Comment operation parameters
export interface CreateCommentParams extends PROperationParams {
  body: string
  path?: string
  position?: number
  line?: number
  side?: string
  commitId?: string
  commentType?: 'pr_comment' | 'file_comment'
}

// Latest commit parameters
export interface LatestCommitParams extends BaseGitHubParams {
  branch?: string
}

// Create PR parameters
export interface CreatePRParams extends BaseGitHubParams {
  title: string
  head: string
  base: string
  body?: string
  draft?: boolean
}

// Update PR parameters
export interface UpdatePRParams extends BaseGitHubParams {
  pullNumber: number
  title?: string
  body?: string
  state?: 'open' | 'closed'
  base?: string
}

// Merge PR parameters
export interface MergePRParams extends BaseGitHubParams {
  pullNumber: number
  commit_title?: string
  commit_message?: string
  merge_method?: 'merge' | 'squash' | 'rebase'
}

// List PRs parameters
export interface ListPRsParams extends BaseGitHubParams {
  state?: 'open' | 'closed' | 'all'
  head?: string
  base?: string
  sort?: 'created' | 'updated' | 'popularity' | 'long-running'
  direction?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

// Get PR files parameters
export interface GetPRFilesParams extends BaseGitHubParams {
  pullNumber: number
  per_page?: number
  page?: number
}

// Close PR parameters
export interface ClosePRParams extends BaseGitHubParams {
  pullNumber: number
}

// Request reviewers parameters
export interface RequestReviewersParams extends BaseGitHubParams {
  pullNumber: number
  reviewers: string
  team_reviewers?: string
}

// Response metadata interfaces
interface BasePRMetadata {
  number: number
  title: string
  state: string
  html_url: string
  diff_url: string
  created_at: string
  updated_at: string
}

interface PRFilesMetadata {
  files?: Array<{
    filename: string
    additions: number
    deletions: number
    changes: number
    patch?: string
    blob_url: string
    raw_url: string
    status: string
  }>
}

interface PRCommentsMetadata {
  comments?: Array<{
    id: number
    body: string
    path?: string
    line?: number
    commit_id: string
    created_at: string
    updated_at: string
    html_url: string
  }>
}

interface CommentMetadata {
  id: number
  html_url: string
  created_at: string
  updated_at: string
  path?: string
  line?: number
  side?: string
  commit_id?: string
}

interface CommitMetadata {
  sha: string
  html_url: string
  commit_message: string
  author: {
    name: string
    login: string
    avatar_url: string
    html_url: string
  }
  committer: {
    name: string
    login: string
    avatar_url: string
    html_url: string
  }
  stats?: {
    additions: number
    deletions: number
    total: number
  }
  files?: Array<{
    filename: string
    additions: number
    deletions: number
    changes: number
    status: string
    raw_url: string
    blob_url: string
    patch?: string
    content?: string
  }>
}

interface RepoMetadata {
  name: string
  description: string
  stars: number
  forks: number
  openIssues: number
  language: string
}

// PR operation response metadata
interface PRMetadata {
  number: number
  title: string
  state: string
  html_url: string
  merged: boolean
  draft: boolean
  created_at?: string
  updated_at?: string
  merge_commit_sha?: string
}

interface MergeResultMetadata {
  sha: string
  merged: boolean
  message: string
}

interface PRListMetadata {
  prs: Array<{
    number: number
    title: string
    state: string
    html_url: string
    created_at: string
    updated_at: string
  }>
  total_count: number
  open_count?: number
  closed_count?: number
}

interface PRFilesListMetadata {
  files: Array<{
    filename: string
    status: string
    additions: number
    deletions: number
    changes: number
    patch?: string
    blob_url: string
    raw_url: string
  }>
  total_count: number
}

interface ReviewersMetadata {
  requested_reviewers: Array<{
    login: string
    id: number
  }>
  requested_teams?: Array<{
    name: string
    id: number
  }>
}

// Response types
export interface PullRequestResponse extends ToolResponse {
  output: {
    content: string
    metadata: BasePRMetadata & PRFilesMetadata & PRCommentsMetadata
  }
}

export interface CreateCommentResponse extends ToolResponse {
  output: {
    content: string
    metadata: CommentMetadata
  }
}

export interface LatestCommitResponse extends ToolResponse {
  output: {
    content: string
    metadata: CommitMetadata
  }
}

export interface RepoInfoResponse extends ToolResponse {
  output: {
    content: string
    metadata: RepoMetadata
  }
}

// Issue comment operation parameters
export interface CreateIssueCommentParams extends BaseGitHubParams {
  issue_number: number
  body: string
}

export interface ListIssueCommentsParams extends BaseGitHubParams {
  issue_number: number
  since?: string
  per_page?: number
  page?: number
}

export interface UpdateCommentParams extends BaseGitHubParams {
  comment_id: number
  body: string
}

export interface DeleteCommentParams extends BaseGitHubParams {
  comment_id: number
}

export interface ListPRCommentsParams extends BaseGitHubParams {
  pullNumber: number
  sort?: 'created' | 'updated'
  direction?: 'asc' | 'desc'
  since?: string
  per_page?: number
  page?: number
}

// Branch operation parameters
export interface ListBranchesParams extends BaseGitHubParams {
  protected?: boolean
  per_page?: number
  page?: number
}

export interface GetBranchParams extends BaseGitHubParams {
  branch: string
}

export interface CreateBranchParams extends BaseGitHubParams {
  branch: string
  sha: string // commit SHA to point to
}

export interface DeleteBranchParams extends BaseGitHubParams {
  branch: string
}

export interface GetBranchProtectionParams extends BaseGitHubParams {
  branch: string
}

export interface UpdateBranchProtectionParams extends BaseGitHubParams {
  branch: string
  required_status_checks: {
    strict: boolean
    contexts: string[]
  } | null
  enforce_admins: boolean
  required_pull_request_reviews: {
    required_approving_review_count?: number
    dismiss_stale_reviews?: boolean
    require_code_owner_reviews?: boolean
  } | null
  restrictions: {
    users: string[]
    teams: string[]
  } | null
}

// Issue comment response metadata
interface IssueCommentMetadata {
  id: number
  html_url: string
  body: string
  created_at: string
  updated_at: string
  user: {
    login: string
    id: number
  }
}

interface CommentsListMetadata {
  comments: Array<{
    id: number
    body: string
    user: { login: string }
    created_at: string
    html_url: string
  }>
  total_count: number
}

// Response types for new tools
export interface IssueCommentResponse extends ToolResponse {
  output: {
    content: string
    metadata: IssueCommentMetadata
  }
}

export interface CommentsListResponse extends ToolResponse {
  output: {
    content: string
    metadata: CommentsListMetadata
  }
}

export interface DeleteCommentResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      deleted: boolean
      comment_id: number
    }
  }
}

// New PR operation response types
export interface PRResponse extends ToolResponse {
  output: {
    content: string
    metadata: PRMetadata
  }
}

export interface MergeResultResponse extends ToolResponse {
  output: {
    content: string
    metadata: MergeResultMetadata
  }
}

export interface PRListResponse extends ToolResponse {
  output: {
    content: string
    metadata: PRListMetadata
  }
}

export interface PRFilesListResponse extends ToolResponse {
  output: {
    content: string
    metadata: PRFilesListMetadata
  }
}

export interface ReviewersResponse extends ToolResponse {
  output: {
    content: string
    metadata: ReviewersMetadata
  }
}

// Branch response metadata
interface BranchMetadata {
  name: string
  commit: {
    sha: string
    url: string
  }
  protected: boolean
}

interface BranchListMetadata {
  branches: Array<{
    name: string
    commit: {
      sha: string
      url: string
    }
    protected: boolean
  }>
  total_count: number
}

interface BranchProtectionMetadata {
  required_status_checks: {
    strict: boolean
    contexts: string[]
  } | null
  enforce_admins: {
    enabled: boolean
  }
  required_pull_request_reviews: {
    required_approving_review_count: number
    dismiss_stale_reviews: boolean
    require_code_owner_reviews: boolean
  } | null
  restrictions: {
    users: string[]
    teams: string[]
  } | null
}

interface RefMetadata {
  ref: string
  url: string
  sha: string
}

interface DeleteBranchMetadata {
  deleted: boolean
  branch: string
}

// Branch response types
export interface BranchResponse extends ToolResponse {
  output: {
    content: string
    metadata: BranchMetadata
  }
}

export interface BranchListResponse extends ToolResponse {
  output: {
    content: string
    metadata: BranchListMetadata
  }
}

export interface BranchProtectionResponse extends ToolResponse {
  output: {
    content: string
    metadata: BranchProtectionMetadata
  }
}

export interface RefResponse extends ToolResponse {
  output: {
    content: string
    metadata: RefMetadata
  }
}

export interface DeleteBranchResponse extends ToolResponse {
  output: {
    content: string
    metadata: DeleteBranchMetadata
  }
}

// GitHub Projects V2 parameters
export interface ListProjectsParams {
  owner_type: 'org' | 'user'
  owner_login: string
  apiKey: string
}

export interface GetProjectParams {
  owner_type: 'org' | 'user'
  owner_login: string
  project_number: number
  apiKey: string
}

export interface CreateProjectParams {
  owner_id: string // Node ID
  title: string
  apiKey: string
}

export interface UpdateProjectParams {
  project_id: string // Node ID
  title?: string
  shortDescription?: string
  project_public?: boolean
  closed?: boolean
  apiKey: string
}

export interface DeleteProjectParams {
  project_id: string
  apiKey: string
}

// GitHub Projects V2 response metadata
interface ProjectMetadata {
  id: string
  title: string
  number?: number
  url: string
  closed?: boolean
  public?: boolean
  shortDescription?: string
}

// GitHub Projects V2 response types
export interface ListProjectsResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      projects: ProjectMetadata[]
      totalCount: number
    }
  }
}

export interface ProjectResponse extends ToolResponse {
  output: {
    content: string
    metadata: ProjectMetadata
  }
}

// Workflow operation parameters
export interface ListWorkflowsParams extends BaseGitHubParams {
  per_page?: number
  page?: number
}

export interface GetWorkflowParams extends BaseGitHubParams {
  workflow_id: number | string
}

export interface TriggerWorkflowParams extends BaseGitHubParams {
  workflow_id: number | string
  ref: string // branch or tag name
  inputs?: Record<string, string>
}

export interface ListWorkflowRunsParams extends BaseGitHubParams {
  actor?: string
  branch?: string
  event?: string
  status?: string
  per_page?: number
  page?: number
}

export interface GetWorkflowRunParams extends BaseGitHubParams {
  run_id: number
}

export interface CancelWorkflowRunParams extends BaseGitHubParams {
  run_id: number
}

export interface RerunWorkflowParams extends BaseGitHubParams {
  run_id: number
  enable_debug_logging?: boolean
}

// Workflow response metadata interfaces
interface WorkflowMetadata {
  id: number
  name: string
  path: string
  state: string
  badge_url: string
}

interface WorkflowRunMetadata {
  id: number
  name: string
  status: string
  conclusion: string
  html_url: string
  run_number: number
}

interface ListWorkflowsMetadata {
  total_count: number
  workflows: Array<{
    id: number
    name: string
    path: string
    state: string
    badge_url: string
  }>
}

interface ListWorkflowRunsMetadata {
  total_count: number
  workflow_runs: Array<{
    id: number
    name: string
    status: string
    conclusion: string
    html_url: string
    run_number: number
  }>
}

// Workflow response types
export interface WorkflowResponse extends ToolResponse {
  output: {
    content: string
    metadata: WorkflowMetadata
  }
}

export interface WorkflowRunResponse extends ToolResponse {
  output: {
    content: string
    metadata: WorkflowRunMetadata
  }
}

export interface ListWorkflowsResponse extends ToolResponse {
  output: {
    content: string
    metadata: ListWorkflowsMetadata
  }
}

export interface ListWorkflowRunsResponse extends ToolResponse {
  output: {
    content: string
    metadata: ListWorkflowRunsMetadata
  }
}

export interface TriggerWorkflowResponse extends ToolResponse {
  output: {
    content: string
    metadata: Record<string, never>
  }
}

export interface CancelWorkflowRunResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      run_id: number
      status: string
    }
  }
}

export interface RerunWorkflowResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      run_id: number
      status: string
    }
  }
}

export type GitHubResponse =
  | PullRequestResponse
  | CreateCommentResponse
  | LatestCommitResponse
  | RepoInfoResponse
  | IssueCommentResponse
  | CommentsListResponse
  | DeleteCommentResponse
  | PRResponse
  | MergeResultResponse
  | PRListResponse
  | PRFilesListResponse
  | ReviewersResponse
  | ListProjectsResponse
  | ProjectResponse
  | BranchResponse
  | BranchListResponse
  | BranchProtectionResponse
  | RefResponse
  | DeleteBranchResponse
  | WorkflowResponse
  | WorkflowRunResponse
  | ListWorkflowsResponse
  | ListWorkflowRunsResponse
  | TriggerWorkflowResponse
  | CancelWorkflowRunResponse
  | RerunWorkflowResponse
  | IssueResponse
  | IssuesListResponse
  | LabelsResponse

// Release operation parameters
export interface CreateReleaseParams extends BaseGitHubParams {
  tag_name: string
  target_commitish?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
}

export interface UpdateReleaseParams extends BaseGitHubParams {
  release_id: number
  tag_name?: string
  target_commitish?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
}

export interface ListReleasesParams extends BaseGitHubParams {
  per_page?: number
  page?: number
}

export interface GetReleaseParams extends BaseGitHubParams {
  release_id: number
}

export interface DeleteReleaseParams extends BaseGitHubParams {
  release_id: number
}

// Release metadata interface
interface ReleaseMetadata {
  id: number
  tag_name: string
  name: string
  html_url: string
  tarball_url: string
  zipball_url: string
  draft: boolean
  prerelease: boolean
  created_at: string
  published_at: string
}

// Response types for releases
export interface ReleaseResponse extends ToolResponse {
  output: {
    content: string
    metadata: ReleaseMetadata
  }
}

export interface ListReleasesResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      total_count: number
      releases: Array<ReleaseMetadata>
    }
  }
}

export interface DeleteReleaseResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      deleted: boolean
      release_id: number
    }
  }
}

// Issue operation parameters
export interface CreateIssueParams extends BaseGitHubParams {
  title: string
  body?: string
  assignees?: string
  labels?: string
  milestone?: number
}

export interface UpdateIssueParams extends BaseGitHubParams {
  issue_number: number
  title?: string
  body?: string
  state?: 'open' | 'closed'
  labels?: string[]
  assignees?: string[]
}

export interface ListIssuesParams extends BaseGitHubParams {
  state?: 'open' | 'closed' | 'all'
  assignee?: string
  creator?: string
  labels?: string
  sort?: 'created' | 'updated' | 'comments'
  direction?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

export interface GetIssueParams extends BaseGitHubParams {
  issue_number: number
}

export interface CloseIssueParams extends BaseGitHubParams {
  issue_number: number
  state_reason?: 'completed' | 'not_planned'
}

export interface AddLabelsParams extends BaseGitHubParams {
  issue_number: number
  labels: string
}

export interface RemoveLabelParams extends BaseGitHubParams {
  issue_number: number
  name: string
}

export interface AddAssigneesParams extends BaseGitHubParams {
  issue_number: number
  assignees: string
}

// Issue response metadata
interface IssueMetadata {
  number: number
  title: string
  state: string
  html_url: string
  labels: string[]
  assignees: string[]
  created_at?: string
  updated_at?: string
  closed_at?: string
  body?: string
}

interface IssuesListMetadata {
  issues: Array<{
    number: number
    title: string
    state: string
    html_url: string
    labels: string[]
    assignees: string[]
    created_at: string
    updated_at: string
  }>
  total_count: number
  page?: number
}

interface LabelsMetadata {
  labels: string[]
  issue_number: number
  html_url: string
}

// Issue response types
export interface IssueResponse extends ToolResponse {
  output: {
    content: string
    metadata: IssueMetadata
  }
}

export interface IssuesListResponse extends ToolResponse {
  output: {
    content: string
    metadata: IssuesListMetadata
  }
}

export interface LabelsResponse extends ToolResponse {
  output: {
    content: string
    metadata: LabelsMetadata
  }
}

export interface GetFileContentParams extends BaseGitHubParams {
  path: string
  ref?: string // branch, tag, or commit SHA
}

export interface CreateFileParams extends BaseGitHubParams {
  path: string
  message: string
  content: string // Plain text (will be Base64 encoded internally)
  branch?: string
}

export interface UpdateFileParams extends BaseGitHubParams {
  path: string
  message: string
  content: string // Plain text (will be Base64 encoded internally)
  sha: string // Required for update
  branch?: string
}

export interface DeleteFileParams extends BaseGitHubParams {
  path: string
  message: string
  sha: string // Required
  branch?: string
}

export interface GetTreeParams extends BaseGitHubParams {
  path?: string
  ref?: string
}

// File/Content metadata interfaces
export interface FileContentMetadata {
  name: string
  path: string
  sha: string
  size: number
  type: 'file' | 'dir'
  download_url?: string
  html_url?: string
}

export interface FileCommitMetadata {
  sha: string
  message: string
  author: {
    name: string
    email: string
    date: string
  }
  committer: {
    name: string
    email: string
    date: string
  }
  html_url: string
}

export interface TreeItemMetadata {
  name: string
  path: string
  sha: string
  size: number
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  download_url?: string
  html_url?: string
}

// Response types
export interface FileContentResponse extends ToolResponse {
  output: {
    content: string
    file?: ToolFileData
    metadata: FileContentMetadata
  }
}

export interface FileOperationResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      file: FileContentMetadata
      commit: FileCommitMetadata
    }
  }
}

export interface DeleteFileResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      deleted: boolean
      path: string
      commit: FileCommitMetadata
    }
  }
}

export interface TreeResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      path: string
      items: TreeItemMetadata[]
      total_count: number
    }
  }
}
