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
    action: {
      type: 'string',
      description: 'The action that was performed (e.g., opened, closed, synchronize)',
    },
    event_type: {
      type: 'string',
      description: 'Type of GitHub event (e.g., push, pull_request, issues)',
    },
    repository: {
      type: 'string',
      description: 'Repository full name (owner/repo)',
    },
    repository_name: {
      type: 'string',
      description: 'Repository name only',
    },
    repository_owner: {
      type: 'string',
      description: 'Repository owner username or organization',
    },
    sender: {
      type: 'string',
      description: 'Username of the user who triggered the event',
    },
    sender_id: {
      type: 'string',
      description: 'User ID of the sender',
    },
    ref: {
      type: 'string',
      description: 'Git reference (for push events)',
    },
    before: {
      type: 'string',
      description: 'SHA of the commit before the push',
    },
    after: {
      type: 'string',
      description: 'SHA of the commit after the push',
    },
    commits: {
      type: 'string',
      description: 'Array of commit objects (for push events)',
    },
    pull_request: {
      type: 'string',
      description: 'Pull request object (for pull_request events)',
    },
    issue: {
      type: 'string',
      description: 'Issue object (for issues events)',
    },
    comment: {
      type: 'string',
      description: 'Comment object (for comment events)',
    },
    branch: {
      type: 'string',
      description: 'Branch name extracted from ref',
    },
    commit_message: {
      type: 'string',
      description: 'Latest commit message',
    },
    commit_author: {
      type: 'string',
      description: 'Author of the latest commit',
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
