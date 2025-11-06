import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared sub-blocks configuration for all GitHub webhook triggers
 */
export const githubWebhookSubBlocks: SubBlockConfig[] = [
  {
    id: 'webhookUrlDisplay',
    title: 'Webhook URL',
    type: 'short-input',
    readOnly: true,
    showCopyButton: true,
    useWebhookUrl: true,
    placeholder: 'Webhook URL will be generated',
    mode: 'trigger',
  },
  {
    id: 'contentType',
    title: 'Content Type',
    type: 'dropdown',
    options: [
      { label: 'application/json', id: 'application/json' },
      {
        label: 'application/x-www-form-urlencoded',
        id: 'application/x-www-form-urlencoded',
      },
    ],
    defaultValue: 'application/json',
    description: 'Format GitHub will use when sending the webhook payload.',
    required: true,
    mode: 'trigger',
  },
  {
    id: 'webhookSecret',
    title: 'Webhook Secret',
    type: 'short-input',
    placeholder: 'Generate or enter a strong secret',
    description: 'Validates that webhook deliveries originate from GitHub.',
    password: true,
    required: false,
    mode: 'trigger',
  },
  {
    id: 'sslVerification',
    title: 'SSL Verification',
    type: 'dropdown',
    options: [
      { label: 'Enabled', id: 'enabled' },
      { label: 'Disabled', id: 'disabled' },
    ],
    defaultValue: 'enabled',
    description: 'GitHub verifies SSL certificates when delivering webhooks.',
    required: true,
    mode: 'trigger',
  },
]

/**
 * Generate setup instructions for a specific GitHub event type
 */
export function githubSetupInstructions(
  eventType: string,
  actions?: string[],
  additionalNotes?: string
): string {
  const actionText = actions
    ? ` (<strong>${actions.join(', ')}</strong> ${actions.length === 1 ? 'action' : 'actions'})`
    : ''

  const instructions = [
    'Go to your GitHub Repository > Settings > Webhooks.',
    'Click "Add webhook".',
    'Paste the <strong>Webhook URL</strong> above into the "Payload URL" field.',
    'Select your chosen Content Type from the dropdown.',
    'Enter the <strong>Webhook Secret</strong> into the "Secret" field if you\'ve configured one.',
    'Set SSL verification according to your selection.',
    `Select "Let me select individual events" and check <strong>${eventType}</strong>${actionText}.`,
    'Ensure "Active" is checked and click "Add webhook".',
  ]

  if (additionalNotes) {
    instructions.push(additionalNotes)
  }

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

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
 * Build output schema for issue events
 */
export function buildIssueOutputs(): Record<string, TriggerOutput> {
  return {
    action: {
      type: 'string',
      description: 'Action performed (opened, closed, reopened, edited, etc.)',
    },
    issue: {
      id: {
        type: 'number',
        description: 'Issue ID',
      },
      node_id: {
        type: 'string',
        description: 'Issue node ID',
      },
      number: {
        type: 'number',
        description: 'Issue number',
      },
      title: {
        type: 'string',
        description: 'Issue title',
      },
      body: {
        type: 'string',
        description: 'Issue body/description',
      },
      state: {
        type: 'string',
        description: 'Issue state (open, closed)',
      },
      state_reason: {
        type: 'string',
        description: 'Reason for state (completed, not_planned, reopened)',
      },
      html_url: {
        type: 'string',
        description: 'Issue HTML URL',
      },
      user: userOutputs,
      labels: {
        type: 'array',
        description: 'Array of label objects',
      },
      assignees: {
        type: 'array',
        description: 'Array of assigned users',
      },
      milestone: {
        type: 'object',
        description: 'Milestone object if assigned',
      },
      created_at: {
        type: 'string',
        description: 'Issue creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Issue last update timestamp',
      },
      closed_at: {
        type: 'string',
        description: 'Issue closed timestamp',
      },
    },
    repository: repositoryOutputs,
    sender: userOutputs,
  } as any
}

/**
 * Build output schema for issue comment events
 */
export function buildIssueCommentOutputs(): Record<string, TriggerOutput> {
  return {
    action: {
      type: 'string',
      description: 'Action performed (created, edited, deleted)',
    },
    issue: {
      number: {
        type: 'number',
        description: 'Issue number',
      },
      title: {
        type: 'string',
        description: 'Issue title',
      },
      state: {
        type: 'string',
        description: 'Issue state (open, closed)',
      },
      html_url: {
        type: 'string',
        description: 'Issue HTML URL',
      },
      user: userOutputs,
    },
    comment: {
      id: {
        type: 'number',
        description: 'Comment ID',
      },
      node_id: {
        type: 'string',
        description: 'Comment node ID',
      },
      body: {
        type: 'string',
        description: 'Comment text',
      },
      html_url: {
        type: 'string',
        description: 'Comment HTML URL',
      },
      user: userOutputs,
      created_at: {
        type: 'string',
        description: 'Comment creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Comment last update timestamp',
      },
    },
    repository: repositoryOutputs,
    sender: userOutputs,
  } as any
}

/**
 * Build output schema for pull request events
 */
export function buildPullRequestOutputs(): Record<string, TriggerOutput> {
  return {
    action: {
      type: 'string',
      description: 'Action performed (opened, closed, synchronize, reopened, edited, etc.)',
    },
    number: {
      type: 'number',
      description: 'Pull request number',
    },
    pull_request: {
      id: {
        type: 'number',
        description: 'Pull request ID',
      },
      node_id: {
        type: 'string',
        description: 'Pull request node ID',
      },
      number: {
        type: 'number',
        description: 'Pull request number',
      },
      title: {
        type: 'string',
        description: 'Pull request title',
      },
      body: {
        type: 'string',
        description: 'Pull request description',
      },
      state: {
        type: 'string',
        description: 'Pull request state (open, closed)',
      },
      merged: {
        type: 'boolean',
        description: 'Whether the PR was merged',
      },
      merged_at: {
        type: 'string',
        description: 'Timestamp when PR was merged',
      },
      merged_by: userOutputs,
      draft: {
        type: 'boolean',
        description: 'Whether the PR is a draft',
      },
      html_url: {
        type: 'string',
        description: 'Pull request HTML URL',
      },
      diff_url: {
        type: 'string',
        description: 'Pull request diff URL',
      },
      patch_url: {
        type: 'string',
        description: 'Pull request patch URL',
      },
      user: userOutputs,
      head: {
        ref: {
          type: 'string',
          description: 'Source branch name',
        },
        sha: {
          type: 'string',
          description: 'Source branch commit SHA',
        },
        repo: {
          name: {
            type: 'string',
            description: 'Source repository name',
          },
          full_name: {
            type: 'string',
            description: 'Source repository full name',
          },
        },
      },
      base: {
        ref: {
          type: 'string',
          description: 'Target branch name',
        },
        sha: {
          type: 'string',
          description: 'Target branch commit SHA',
        },
        repo: {
          name: {
            type: 'string',
            description: 'Target repository name',
          },
          full_name: {
            type: 'string',
            description: 'Target repository full name',
          },
        },
      },
      additions: {
        type: 'number',
        description: 'Number of lines added',
      },
      deletions: {
        type: 'number',
        description: 'Number of lines deleted',
      },
      changed_files: {
        type: 'number',
        description: 'Number of files changed',
      },
      labels: {
        type: 'array',
        description: 'Array of label objects',
      },
      assignees: {
        type: 'array',
        description: 'Array of assigned users',
      },
      requested_reviewers: {
        type: 'array',
        description: 'Array of requested reviewers',
      },
      created_at: {
        type: 'string',
        description: 'Pull request creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Pull request last update timestamp',
      },
      closed_at: {
        type: 'string',
        description: 'Pull request closed timestamp',
      },
    },
    repository: repositoryOutputs,
    sender: userOutputs,
  } as any
}

/**
 * Build output schema for PR comment events
 */
export function buildPRCommentOutputs(): Record<string, TriggerOutput> {
  return {
    action: {
      type: 'string',
      description: 'Action performed (created, edited, deleted)',
    },
    issue: {
      number: {
        type: 'number',
        description: 'Pull request number',
      },
      title: {
        type: 'string',
        description: 'Pull request title',
      },
      state: {
        type: 'string',
        description: 'Pull request state (open, closed)',
      },
      html_url: {
        type: 'string',
        description: 'Pull request HTML URL',
      },
      user: userOutputs,
      pull_request: {
        url: {
          type: 'string',
          description: 'Pull request API URL',
        },
        html_url: {
          type: 'string',
          description: 'Pull request HTML URL',
        },
        diff_url: {
          type: 'string',
          description: 'Pull request diff URL',
        },
      },
    },
    comment: {
      id: {
        type: 'number',
        description: 'Comment ID',
      },
      node_id: {
        type: 'string',
        description: 'Comment node ID',
      },
      body: {
        type: 'string',
        description: 'Comment text',
      },
      html_url: {
        type: 'string',
        description: 'Comment HTML URL',
      },
      user: userOutputs,
      created_at: {
        type: 'string',
        description: 'Comment creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Comment last update timestamp',
      },
    },
    repository: repositoryOutputs,
    sender: userOutputs,
  } as any
}

/**
 * Build output schema for PR review events
 */
export function buildPRReviewOutputs(): Record<string, TriggerOutput> {
  return {
    action: {
      type: 'string',
      description: 'Action performed (submitted, edited, dismissed)',
    },
    review: {
      id: {
        type: 'number',
        description: 'Review ID',
      },
      node_id: {
        type: 'string',
        description: 'Review node ID',
      },
      body: {
        type: 'string',
        description: 'Review comment body',
      },
      state: {
        type: 'string',
        description: 'Review state (approved, changes_requested, commented, dismissed)',
      },
      html_url: {
        type: 'string',
        description: 'Review HTML URL',
      },
      user: userOutputs,
      submitted_at: {
        type: 'string',
        description: 'Review submission timestamp',
      },
    },
    pull_request: {
      number: {
        type: 'number',
        description: 'Pull request number',
      },
      title: {
        type: 'string',
        description: 'Pull request title',
      },
      state: {
        type: 'string',
        description: 'Pull request state (open, closed)',
      },
      html_url: {
        type: 'string',
        description: 'Pull request HTML URL',
      },
      user: userOutputs,
      head: {
        ref: {
          type: 'string',
          description: 'Source branch name',
        },
      },
      base: {
        ref: {
          type: 'string',
          description: 'Target branch name',
        },
      },
    },
    repository: repositoryOutputs,
    sender: userOutputs,
  } as any
}

/**
 * Build output schema for push events
 */
export function buildPushOutputs(): Record<string, TriggerOutput> {
  return {
    ref: {
      type: 'string',
      description: 'Git reference (e.g., refs/heads/main)',
    },
    before: {
      type: 'string',
      description: 'SHA of the commit before the push',
    },
    after: {
      type: 'string',
      description: 'SHA of the commit after the push',
    },
    created: {
      type: 'boolean',
      description: 'Whether the push created the reference',
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the push deleted the reference',
    },
    forced: {
      type: 'boolean',
      description: 'Whether the push was forced',
    },
    compare: {
      type: 'string',
      description: 'URL to compare the changes',
    },
    commits: {
      type: 'array',
      description: 'Array of commit objects',
      id: {
        type: 'string',
        description: 'Commit SHA',
      },
      message: {
        type: 'string',
        description: 'Commit message',
      },
      timestamp: {
        type: 'string',
        description: 'Commit timestamp',
      },
      url: {
        type: 'string',
        description: 'Commit URL',
      },
      author: {
        name: {
          type: 'string',
          description: 'Author name',
        },
        email: {
          type: 'string',
          description: 'Author email',
        },
      },
      added: {
        type: 'array',
        description: 'Array of added files',
      },
      removed: {
        type: 'array',
        description: 'Array of removed files',
      },
      modified: {
        type: 'array',
        description: 'Array of modified files',
      },
    },
    head_commit: {
      id: {
        type: 'string',
        description: 'Commit SHA',
      },
      message: {
        type: 'string',
        description: 'Commit message',
      },
      timestamp: {
        type: 'string',
        description: 'Commit timestamp',
      },
      author: {
        name: {
          type: 'string',
          description: 'Author name',
        },
        email: {
          type: 'string',
          description: 'Author email',
        },
      },
    },
    pusher: {
      name: {
        type: 'string',
        description: 'Pusher name',
      },
      email: {
        type: 'string',
        description: 'Pusher email',
      },
    },
    branch: {
      type: 'string',
      description: 'Branch name extracted from ref',
    },
    repository: repositoryOutputs,
    sender: userOutputs,
  } as any
}

/**
 * Build output schema for release events
 */
export function buildReleaseOutputs(): Record<string, TriggerOutput> {
  return {
    action: {
      type: 'string',
      description: 'Action performed (published, created, edited, deleted, prereleased, released)',
    },
    release: {
      id: {
        type: 'number',
        description: 'Release ID',
      },
      node_id: {
        type: 'string',
        description: 'Release node ID',
      },
      tag_name: {
        type: 'string',
        description: 'Git tag name',
      },
      target_commitish: {
        type: 'string',
        description: 'Target branch or commit',
      },
      name: {
        type: 'string',
        description: 'Release name/title',
      },
      body: {
        type: 'string',
        description: 'Release notes/description',
      },
      draft: {
        type: 'boolean',
        description: 'Whether the release is a draft',
      },
      prerelease: {
        type: 'boolean',
        description: 'Whether the release is a pre-release',
      },
      html_url: {
        type: 'string',
        description: 'Release HTML URL',
      },
      tarball_url: {
        type: 'string',
        description: 'Tarball download URL',
      },
      zipball_url: {
        type: 'string',
        description: 'Zipball download URL',
      },
      author: userOutputs,
      assets: {
        type: 'array',
        description: 'Array of release asset objects',
      },
      created_at: {
        type: 'string',
        description: 'Release creation timestamp',
      },
      published_at: {
        type: 'string',
        description: 'Release publication timestamp',
      },
    },
    repository: repositoryOutputs,
    sender: userOutputs,
  } as any
}

/**
 * Check if a GitHub event matches the expected trigger configuration
 * This is used for event filtering in the webhook processor
 */
export function isGitHubEventMatch(
  triggerId: string,
  eventType: string,
  action?: string,
  payload?: any
): boolean {
  const eventMap: Record<
    string,
    { event: string; actions?: string[]; validator?: (payload: any) => boolean }
  > = {
    github_issue_opened: { event: 'issues', actions: ['opened'] },
    github_issue_closed: { event: 'issues', actions: ['closed'] },
    github_issue_comment: {
      event: 'issue_comment',
      validator: (p) => !p.issue?.pull_request, // Only issues, not PRs
    },
    github_pr_opened: { event: 'pull_request', actions: ['opened'] },
    github_pr_closed: {
      event: 'pull_request',
      actions: ['closed'],
      validator: (p) => p.pull_request?.merged === false, // Not merged
    },
    github_pr_merged: {
      event: 'pull_request',
      actions: ['closed'],
      validator: (p) => p.pull_request?.merged === true, // Merged
    },
    github_pr_comment: {
      event: 'issue_comment',
      validator: (p) => !!p.issue?.pull_request, // Only PRs, not issues
    },
    github_pr_reviewed: { event: 'pull_request_review', actions: ['submitted'] },
    github_push: { event: 'push' },
    github_release_published: { event: 'release', actions: ['published'] },
  }

  const config = eventMap[triggerId]
  if (!config) {
    return true // Unknown trigger, allow through
  }

  // Check event type
  if (config.event !== eventType) {
    return false
  }

  // Check action if specified
  if (config.actions && action && !config.actions.includes(action)) {
    return false
  }

  // Run custom validator if provided
  if (config.validator && payload) {
    return config.validator(payload)
  }

  return true
}
