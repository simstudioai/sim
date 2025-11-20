import { GithubIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const githubWorkflowRunTrigger: TriggerConfig = {
  id: 'github_workflow_run',
  name: 'GitHub Actions Workflow Run',
  provider: 'github',
  description:
    'Trigger workflow when a GitHub Actions workflow run is requested, in progress, or completed',
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
        value: 'github_workflow_run',
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
        value: 'github_workflow_run',
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
        value: 'github_workflow_run',
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
        value: 'github_workflow_run',
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
        'Select "Let me select individual events" and check <strong>Workflow runs</strong>.',
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
        value: 'github_workflow_run',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'github_workflow_run',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_workflow_run',
      },
    },
  ],

  outputs: {
    action: {
      type: 'string',
      description: 'Action performed (requested, in_progress, completed)',
    },
    workflow_run: {
      id: {
        type: 'number',
        description: 'Workflow run ID',
      },
      node_id: {
        type: 'string',
        description: 'Workflow run node ID',
      },
      name: {
        type: 'string',
        description: 'Workflow name',
      },
      workflow_id: {
        type: 'number',
        description: 'Workflow ID',
      },
      run_number: {
        type: 'number',
        description: 'Run number for this workflow',
      },
      run_attempt: {
        type: 'number',
        description: 'Attempt number for this run',
      },
      event: {
        type: 'string',
        description: 'Event that triggered the workflow (push, pull_request, etc.)',
      },
      status: {
        type: 'string',
        description: 'Current status (queued, in_progress, completed)',
      },
      conclusion: {
        type: 'string',
        description:
          'Conclusion (success, failure, cancelled, skipped, timed_out, action_required)',
      },
      head_branch: {
        type: 'string',
        description: 'Branch name',
      },
      head_sha: {
        type: 'string',
        description: 'Commit SHA that triggered the workflow',
      },
      path: {
        type: 'string',
        description: 'Path to the workflow file',
      },
      display_title: {
        type: 'string',
        description: 'Display title for the run',
      },
      run_started_at: {
        type: 'string',
        description: 'Timestamp when the run started',
      },
      created_at: {
        type: 'string',
        description: 'Workflow run creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Workflow run last update timestamp',
      },
      html_url: {
        type: 'string',
        description: 'Workflow run HTML URL',
      },
      check_suite_id: {
        type: 'number',
        description: 'Associated check suite ID',
      },
      check_suite_node_id: {
        type: 'string',
        description: 'Associated check suite node ID',
      },
      url: {
        type: 'string',
        description: 'Workflow run API URL',
      },
      actor: {
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
      triggering_actor: {
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
          description: 'Repository full name',
        },
        private: {
          type: 'boolean',
          description: 'Whether repository is private',
        },
      },
      head_repository: {
        id: {
          type: 'number',
          description: 'Head repository ID',
        },
        node_id: {
          type: 'string',
          description: 'Head repository node ID',
        },
        name: {
          type: 'string',
          description: 'Head repository name',
        },
        full_name: {
          type: 'string',
          description: 'Head repository full name',
        },
        private: {
          type: 'boolean',
          description: 'Whether repository is private',
        },
      },
      head_commit: {
        id: {
          type: 'string',
          description: 'Commit SHA',
        },
        tree_id: {
          type: 'string',
          description: 'Tree ID',
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
        committer: {
          name: {
            type: 'string',
            description: 'Committer name',
          },
          email: {
            type: 'string',
            description: 'Committer email',
          },
        },
      },
      pull_requests: {
        type: 'array',
        description: 'Array of associated pull requests',
      },
      referenced_workflows: {
        type: 'array',
        description: 'Array of referenced workflow runs',
      },
    },
    workflow: {
      id: {
        type: 'number',
        description: 'Workflow ID',
      },
      node_id: {
        type: 'string',
        description: 'Workflow node ID',
      },
      name: {
        type: 'string',
        description: 'Workflow name',
      },
      path: {
        type: 'string',
        description: 'Path to workflow file',
      },
      state: {
        type: 'string',
        description: 'Workflow state (active, deleted, disabled_fork, etc.)',
      },
      created_at: {
        type: 'string',
        description: 'Workflow creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Workflow last update timestamp',
      },
      url: {
        type: 'string',
        description: 'Workflow API URL',
      },
      html_url: {
        type: 'string',
        description: 'Workflow HTML URL',
      },
      badge_url: {
        type: 'string',
        description: 'Workflow badge URL',
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
      'X-GitHub-Event': 'workflow_run',
      'X-GitHub-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'X-Hub-Signature-256': 'sha256=...',
    },
  },
}
