import { GithubIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const githubPushTrigger: TriggerConfig = {
  id: 'github_push',
  name: 'GitHub Push',
  provider: 'github',
  description: 'Trigger workflow when code is pushed to a repository',
  version: '1.0.0',
  icon: GithubIcon,

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_push',
      },
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
      condition: {
        field: 'selectedTriggerId',
        value: 'github_push',
      },
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
      condition: {
        field: 'selectedTriggerId',
        value: 'github_push',
      },
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
      condition: {
        field: 'selectedTriggerId',
        value: 'github_push',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Go to your GitHub Repository > Settings > Webhooks.',
        'Click "Add webhook".',
        'Paste the <strong>Webhook URL</strong> above into the "Payload URL" field.',
        'Select your chosen Content Type from the dropdown.',
        'Enter the <strong>Webhook Secret</strong> into the "Secret" field if you\'ve configured one.',
        'Set SSL verification according to your selection.',
        'Select "Let me select individual events" and check <strong>Pushes</strong>.',
        'Ensure "Active" is checked and click "Add webhook".',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_push',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'github_push',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_push',
      },
    },
  ],

  outputs: {
    ref: {
      type: 'string',
      description: 'Git reference that was pushed (e.g., refs/heads/main)',
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
      description: 'Whether this push created a new branch or tag',
    },
    deleted: {
      type: 'boolean',
      description: 'Whether this push deleted a branch or tag',
    },
    forced: {
      type: 'boolean',
      description: 'Whether this was a force push',
    },
    base_ref: {
      type: 'string',
      description: 'Base reference for the push',
    },
    compare: {
      type: 'string',
      description: 'URL to compare the changes',
    },
    commits: {
      type: 'array',
      description: 'Array of commit objects included in this push',
      items: {
        id: {
          type: 'string',
          description: 'Commit SHA',
        },
        tree_id: {
          type: 'string',
          description: 'Git tree SHA',
        },
        distinct: {
          type: 'boolean',
          description: 'Whether this commit is distinct from others in the push',
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
          username: {
            type: 'string',
            description: 'Author GitHub username',
          },
        },
        committer: {
          name: {
            type: 'string',
            description: 'Committer name',
          },
          email: {
            type: 'string',
            description: 'Committer email',
          },
          username: {
            type: 'string',
            description: 'Committer GitHub username',
          },
        },
        added: {
          type: 'array',
          description: 'Array of file paths added in this commit',
        },
        removed: {
          type: 'array',
          description: 'Array of file paths removed in this commit',
        },
        modified: {
          type: 'array',
          description: 'Array of file paths modified in this commit',
        },
      },
    },
    head_commit: {
      id: {
        type: 'string',
        description: 'Commit SHA of the most recent commit',
      },
      tree_id: {
        type: 'string',
        description: 'Git tree SHA',
      },
      distinct: {
        type: 'boolean',
        description: 'Whether this commit is distinct',
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
        username: {
          type: 'string',
          description: 'Author GitHub username',
        },
      },
      committer: {
        name: {
          type: 'string',
          description: 'Committer name',
        },
        email: {
          type: 'string',
          description: 'Committer email',
        },
        username: {
          type: 'string',
          description: 'Committer GitHub username',
        },
      },
      added: {
        type: 'array',
        description: 'Array of file paths added in this commit',
      },
      removed: {
        type: 'array',
        description: 'Array of file paths removed in this commit',
      },
      modified: {
        type: 'array',
        description: 'Array of file paths modified in this commit',
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
      repo_description: {
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
        node_id: {
          type: 'string',
          description: 'Owner node ID',
        },
        avatar_url: {
          type: 'string',
          description: 'Owner avatar URL',
        },
        html_url: {
          type: 'string',
          description: 'Owner profile URL',
        },
        owner_type: {
          type: 'string',
          description: 'Owner type (User, Organization)',
        },
      },
    },
    sender: {
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
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'push',
      'X-GitHub-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'X-Hub-Signature-256': 'sha256=...',
    },
  },
}
