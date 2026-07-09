import { isRecordLike } from '@sim/utils/object'

/**
 * Shared repository output schema
 */
export const repositoryOutputs = {
  id: {
    type: 'number',
    description: 'Repository ID',
  },
  node_id: {
    type: 'string',
    description: 'Repository node ID',
  },
  name: {
    type: 'string',
    description: 'Repository name',
  },
  full_name: {
    type: 'string',
    description: 'Repository full name (owner/repo)',
  },
  private: {
    type: 'boolean',
    description: 'Whether the repository is private',
  },
  html_url: {
    type: 'string',
    description: 'Repository HTML URL',
  },
  description: {
    type: 'string',
    description: 'Repository description',
  },
  fork: {
    type: 'boolean',
    description: 'Whether the repository is a fork',
  },
  url: {
    type: 'string',
    description: 'Repository API URL',
  },
  homepage: {
    type: 'string',
    description: 'Repository homepage URL',
  },
  size: {
    type: 'number',
    description: 'Repository size in KB',
  },
  stargazers_count: {
    type: 'number',
    description: 'Number of stars',
  },
  watchers_count: {
    type: 'number',
    description: 'Number of watchers',
  },
  language: {
    type: 'string',
    description: 'Primary programming language',
  },
  forks_count: {
    type: 'number',
    description: 'Number of forks',
  },
  open_issues_count: {
    type: 'number',
    description: 'Number of open issues',
  },
  default_branch: {
    type: 'string',
    description: 'Default branch name',
  },
  owner: {
    login: {
      type: 'string',
      description: 'Owner username',
    },
    id: {
      type: 'number',
      description: 'Owner ID',
    },
    avatar_url: {
      type: 'string',
      description: 'Owner avatar URL',
    },
    html_url: {
      type: 'string',
      description: 'Owner profile URL',
    },
  },
} as const

/**
 * Shared sender/user output schema
 */
export const userOutputs = {
  login: {
    type: 'string',
    description: 'Username',
  },
  id: {
    type: 'number',
    description: 'User ID',
  },
  node_id: {
    type: 'string',
    description: 'User node ID',
  },
  avatar_url: {
    type: 'string',
    description: 'Avatar URL',
  },
  html_url: {
    type: 'string',
    description: 'Profile URL',
  },
  user_type: {
    type: 'string',
    description: 'User type (User, Bot, Organization)',
  },
} as const

/**
 * Checks whether a delivered GitHub event matches the expected trigger
 * configuration, used for event filtering in the webhook processor.
 *
 * GitHub fires `issue_comment` for comments on both issues and pull
 * requests, and `pull_request` with action `closed` for both a merge and a
 * close-without-merge; the `validator` entries disambiguate those cases via
 * `issue.pull_request` (present only on PR comments) and
 * `pull_request.merged` respectively.
 */
export function isGitHubEventMatch(
  triggerId: string,
  eventType: string,
  action?: string,
  payload?: unknown
): boolean {
  const eventMap: Record<
    string,
    {
      event: string
      actions?: string[]
      validator?: (payload: Record<string, unknown>) => boolean
    }
  > = {
    github_issue_opened: { event: 'issues', actions: ['opened'] },
    github_issue_closed: { event: 'issues', actions: ['closed'] },
    github_issue_comment: {
      event: 'issue_comment',
      validator: (p) => !isRecordLike(p.issue) || !p.issue.pull_request,
    },
    github_pr_opened: { event: 'pull_request', actions: ['opened'] },
    github_pr_closed: {
      event: 'pull_request',
      actions: ['closed'],
      validator: (p) => isRecordLike(p.pull_request) && p.pull_request.merged === false,
    },
    github_pr_merged: {
      event: 'pull_request',
      actions: ['closed'],
      validator: (p) => isRecordLike(p.pull_request) && p.pull_request.merged === true,
    },
    github_pr_comment: {
      event: 'issue_comment',
      validator: (p) => isRecordLike(p.issue) && !!p.issue.pull_request,
    },
    github_pr_reviewed: { event: 'pull_request_review', actions: ['submitted'] },
    github_push: { event: 'push' },
    github_release_published: { event: 'release', actions: ['published'] },
    github_workflow_run: { event: 'workflow_run' },
  }

  const config = eventMap[triggerId]
  if (!config) {
    return true
  }

  if (config.event !== eventType) {
    return false
  }

  if (config.actions && action && !config.actions.includes(action)) {
    return false
  }

  if (config.validator) {
    return config.validator(isRecordLike(payload) ? payload : {})
  }

  return true
}
