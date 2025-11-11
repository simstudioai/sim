import { GithubIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const githubPRCommentTrigger: TriggerConfig = {
  id: 'github_pr_comment',
  name: 'GitHub PR Comment',
  provider: 'github',
  description: 'Trigger workflow when a comment is added to a pull request in a GitHub repository',
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
        value: 'github_pr_comment',
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
        value: 'github_pr_comment',
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
        value: 'github_pr_comment',
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
        value: 'github_pr_comment',
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
        'Select "Let me select individual events" and check <strong>Issue comments</strong>.',
        'Ensure "Active" is checked and click "Add webhook".',
        'Note: Pull request comments use the issue_comment event. You can filter for PR comments by checking if issue.pull_request exists.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_pr_comment',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'github_pr_comment',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_pr_comment',
      },
    },
  ],

  outputs: {
    action: {
      type: 'string',
      description: 'Action performed (created, edited, deleted)',
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
        description: 'Issue/PR number',
      },
      title: {
        type: 'string',
        description: 'Issue/PR title',
      },
      body: {
        type: 'string',
        description: 'Issue/PR description',
      },
      state: {
        type: 'string',
        description: 'Issue/PR state (open, closed)',
      },
      html_url: {
        type: 'string',
        description: 'Issue/PR HTML URL',
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
      pull_request: {
        url: {
          type: 'string',
          description: 'Pull request API URL (present only for PR comments)',
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
      },
      created_at: {
        type: 'string',
        description: 'Issue/PR creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Issue/PR last update timestamp',
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
      url: {
        type: 'string',
        description: 'Comment API URL',
      },
      html_url: {
        type: 'string',
        description: 'Comment HTML URL',
      },
      body: {
        type: 'string',
        description: 'Comment text',
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
      created_at: {
        type: 'string',
        description: 'Comment creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Comment last update timestamp',
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
      'X-GitHub-Event': 'issue_comment',
      'X-GitHub-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'X-Hub-Signature-256': 'sha256=...',
    },
  },
}
