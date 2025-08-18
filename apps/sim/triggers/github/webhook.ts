import { GithubIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const githubWebhookTrigger: TriggerConfig = {
  id: 'github_webhook',
  name: 'GitHub Webhook',
  provider: 'github',
  description: 'Trigger workflow from GitHub events like push, pull requests, issues, and more',
  version: '1.0.0',
  icon: GithubIcon,

  configFields: {
    contentType: {
      type: 'select',
      label: 'Content Type',
      options: ['application/json', 'application/x-www-form-urlencoded'],
      defaultValue: 'application/json',
      description: 'Format GitHub will use when sending the webhook payload.',
      required: true,
    },
    webhookSecret: {
      type: 'string',
      label: 'Webhook Secret (Recommended)',
      placeholder: 'Generate or enter a strong secret',
      description: 'Validates that webhook deliveries originate from GitHub.',
      required: false,
      isSecret: true,
    },
    sslVerification: {
      type: 'select',
      label: 'SSL Verification',
      options: ['enabled', 'disabled'],
      defaultValue: 'enabled',
      description: 'GitHub verifies SSL certificates when delivering webhooks.',
      required: true,
    },
  },

  outputs: {
    // GitHub webhook payload structure - maps 1:1 to actual GitHub webhook body
    ref: {
      type: 'string',
      description: 'Git reference (e.g., refs/heads/fix/telegram-wh)',
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
    base_ref: {
      type: 'string',
      description: 'Base reference for the push',
    },
    compare: {
      type: 'string',
      description: 'URL to compare the changes',
    },
    repository: {
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
      fork: {
        type: 'boolean',
        description: 'Whether the repository is a fork',
      },
      url: {
        type: 'string',
        description: 'Repository API URL',
      },
      created_at: {
        type: 'number',
        description: 'Repository creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Repository last updated time',
      },
      pushed_at: {
        type: 'number',
        description: 'Repository last push timestamp',
      },
      git_url: {
        type: 'string',
        description: 'Repository git URL',
      },
      ssh_url: {
        type: 'string',
        description: 'Repository SSH URL',
      },
      clone_url: {
        type: 'string',
        description: 'Repository clone URL',
      },
      homepage: {
        type: 'string',
        description: 'Repository homepage URL',
      },
      size: {
        type: 'number',
        description: 'Repository size',
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
      archived: {
        type: 'boolean',
        description: 'Whether the repository is archived',
      },
      disabled: {
        type: 'boolean',
        description: 'Whether the repository is disabled',
      },
      open_issues_count: {
        type: 'number',
        description: 'Number of open issues',
      },
      topics: {
        type: 'array',
        description: 'Repository topics',
      },
      visibility: {
        type: 'string',
        description: 'Repository visibility (public, private)',
      },
      forks: {
        type: 'number',
        description: 'Number of forks',
      },
      open_issues: {
        type: 'number',
        description: 'Number of open issues',
      },
      watchers: {
        type: 'number',
        description: 'Number of watchers',
      },
      default_branch: {
        type: 'string',
        description: 'Default branch name',
      },
      stargazers: {
        type: 'number',
        description: 'Number of stargazers',
      },
      master_branch: {
        type: 'string',
        description: 'Master branch name',
      },
      owner: {
        name: {
          type: 'string',
          description: 'Owner name',
        },
        email: {
          type: 'string',
          description: 'Owner email',
        },
        login: {
          type: 'string',
          description: 'Owner username',
        },
        id: {
          type: 'number',
          description: 'Owner ID',
        },
        node_id: {
          type: 'string',
          description: 'Owner node ID',
        },
        avatar_url: {
          type: 'string',
          description: 'Owner avatar URL',
        },
        gravatar_id: {
          type: 'string',
          description: 'Owner gravatar ID',
        },
        url: {
          type: 'string',
          description: 'Owner API URL',
        },
        html_url: {
          type: 'string',
          description: 'Owner profile URL',
        },
        user_view_type: {
          type: 'string',
          description: 'User view type',
        },
        site_admin: {
          type: 'boolean',
          description: 'Whether the owner is a site admin',
        },
      },
      license: {
        type: 'object',
        description: 'Repository license information',
        key: {
          type: 'string',
          description: 'License key (e.g., apache-2.0)',
        },
        name: {
          type: 'string',
          description: 'License name',
        },
        spdx_id: {
          type: 'string',
          description: 'SPDX license identifier',
        },
        url: {
          type: 'string',
          description: 'License URL',
        },
        node_id: {
          type: 'string',
          description: 'License node ID',
        },
      },
    },
    pusher: {
      type: 'object',
      description: 'Information about who pushed the changes',
      name: {
        type: 'string',
        description: 'Pusher name',
      },
      email: {
        type: 'string',
        description: 'Pusher email',
      },
    },
    sender: {
      login: {
        type: 'string',
        description: 'Sender username',
      },
      id: {
        type: 'number',
        description: 'Sender ID',
      },
      node_id: {
        type: 'string',
        description: 'Sender node ID',
      },
      avatar_url: {
        type: 'string',
        description: 'Sender avatar URL',
      },
      gravatar_id: {
        type: 'string',
        description: 'Sender gravatar ID',
      },
      url: {
        type: 'string',
        description: 'Sender API URL',
      },
      html_url: {
        type: 'string',
        description: 'Sender profile URL',
      },
      user_view_type: {
        type: 'string',
        description: 'User view type',
      },
      site_admin: {
        type: 'boolean',
        description: 'Whether the sender is a site admin',
      },
    },
    commits: {
      type: 'array',
      description: 'Array of commit objects',
      id: {
        type: 'string',
        description: 'Commit SHA',
      },
      tree_id: {
        type: 'string',
        description: 'Tree SHA',
      },
      distinct: {
        type: 'boolean',
        description: 'Whether the commit is distinct',
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
        type: 'object',
        description: 'Commit author',
        name: {
          type: 'string',
          description: 'Author name',
        },
        email: {
          type: 'string',
          description: 'Author email',
        },
      },
      committer: {
        type: 'object',
        description: 'Commit committer',
        name: {
          type: 'string',
          description: 'Committer name',
        },
        email: {
          type: 'string',
          description: 'Committer email',
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
      type: 'object',
      description: 'Head commit object',
      id: {
        type: 'string',
        description: 'Commit SHA',
      },
      tree_id: {
        type: 'string',
        description: 'Tree SHA',
      },
      distinct: {
        type: 'boolean',
        description: 'Whether the commit is distinct',
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
        type: 'object',
        description: 'Commit author',
        name: {
          type: 'string',
          description: 'Author name',
        },
        email: {
          type: 'string',
          description: 'Author email',
        },
      },
      committer: {
        type: 'object',
        description: 'Commit committer',
        name: {
          type: 'string',
          description: 'Committer name',
        },
        email: {
          type: 'string',
          description: 'Committer email',
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

    // Convenient flat fields for easy access
    event_type: {
      type: 'string',
      description: 'Type of GitHub event (e.g., push, pull_request, issues)',
    },
    action: {
      type: 'string',
      description: 'The action that was performed (e.g., opened, closed, synchronize)',
    },
    branch: {
      type: 'string',
      description: 'Branch name extracted from ref',
    },
  },

  instructions: [
    'Go to your GitHub Repository > Settings > Webhooks.',
    'Click "Add webhook".',
    'Paste the <strong>Webhook URL</strong> (from above) into the "Payload URL" field.',
    'Select your chosen Content Type from the dropdown above.',
    'Enter the <strong>Webhook Secret</strong> (from above) into the "Secret" field if you\'ve configured one.',
    'Set SSL verification according to your selection above.',
    'Choose which events should trigger this webhook.',
    'Ensure "Active" is checked and click "Add webhook".',
  ],

  samplePayload: {
    action: 'opened',
    number: 1,
    pull_request: {
      id: 1,
      number: 1,
      state: 'open',
      title: 'Update README',
      user: {
        login: 'octocat',
        id: 1,
      },
      body: 'This is a pretty simple change that we need to pull into main.',
      head: {
        ref: 'feature-branch',
        sha: 'abc123',
      },
      base: {
        ref: 'main',
        sha: 'def456',
      },
    },
    repository: {
      id: 35129377,
      name: 'public-repo',
      full_name: 'baxterthehacker/public-repo',
      owner: {
        login: 'baxterthehacker',
        id: 6752317,
      },
    },
    sender: {
      login: 'baxterthehacker',
      id: 6752317,
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    },
  },
}
