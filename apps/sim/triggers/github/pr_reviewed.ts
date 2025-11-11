import { GithubIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const githubPRReviewedTrigger: TriggerConfig = {
  id: 'github_pr_reviewed',
  name: 'GitHub PR Reviewed',
  provider: 'github',
  description:
    'Trigger workflow when a pull request review is submitted, edited, or dismissed in a GitHub repository',
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
        value: 'github_pr_reviewed',
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
        value: 'github_pr_reviewed',
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
        value: 'github_pr_reviewed',
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
        value: 'github_pr_reviewed',
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
        'Select "Let me select individual events" and check <strong>Pull request reviews</strong>.',
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
        value: 'github_pr_reviewed',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'github_pr_reviewed',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_pr_reviewed',
      },
    },
  ],

  outputs: {
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
      user: {
        login: {
          type: 'string',
          description: 'Reviewer username',
        },
        id: {
          type: 'number',
          description: 'Reviewer user ID',
        },
        node_id: {
          type: 'string',
          description: 'Reviewer node ID',
        },
        avatar_url: {
          type: 'string',
          description: 'Reviewer avatar URL',
        },
        html_url: {
          type: 'string',
          description: 'Reviewer profile URL',
        },
        user_type: {
          type: 'string',
          description: 'User type (User, Bot, Organization)',
        },
      },
      body: {
        type: 'string',
        description: 'Review comment text',
      },
      state: {
        type: 'string',
        description: 'Review state (approved, changes_requested, commented, dismissed)',
      },
      html_url: {
        type: 'string',
        description: 'Review HTML URL',
      },
      submitted_at: {
        type: 'string',
        description: 'Review submission timestamp',
      },
      commit_id: {
        type: 'string',
        description: 'Commit SHA that was reviewed',
      },
      author_association: {
        type: 'string',
        description: 'Author association (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, etc.)',
      },
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
      user: {
        login: {
          type: 'string',
          description: 'PR author username',
        },
        id: {
          type: 'number',
          description: 'PR author user ID',
        },
        node_id: {
          type: 'string',
          description: 'PR author node ID',
        },
        avatar_url: {
          type: 'string',
          description: 'PR author avatar URL',
        },
        html_url: {
          type: 'string',
          description: 'PR author profile URL',
        },
        user_type: {
          type: 'string',
          description: 'User type (User, Bot, Organization)',
        },
      },
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
      created_at: {
        type: 'string',
        description: 'Pull request creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Pull request last update timestamp',
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
      'X-GitHub-Event': 'pull_request_review',
      'X-GitHub-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'X-Hub-Signature-256': 'sha256=...',
    },
  },
}
