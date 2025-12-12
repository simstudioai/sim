import { GithubIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const githubIssueClosedTrigger: TriggerConfig = {
  id: 'github_issue_closed',
  name: 'GitHub Issue Closed',
  provider: 'github',
  description: 'Trigger workflow when an issue is closed in a GitHub repository',
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
        value: 'github_issue_closed',
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
        value: 'github_issue_closed',
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
        value: 'github_issue_closed',
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
        value: 'github_issue_closed',
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
        'Select "Let me select individual events" and check <strong>issues</strong> (<strong>closed</strong> action).',
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
        value: 'github_issue_closed',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'github_issue_closed',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_issue_closed',
      },
    },
  ],

  outputs: {
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
      user: {
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
      'X-GitHub-Event': 'issues',
      'X-GitHub-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'X-Hub-Signature-256': 'sha256=...',
    },
  },
}
