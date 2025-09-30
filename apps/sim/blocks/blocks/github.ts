import { GithubIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GitHubResponse } from '@/tools/github/types'

export const GitHubBlock: BlockConfig<GitHubResponse> = {
  type: 'github',
  name: 'GitHub',
  description: 'Interact with GitHub or trigger workflows from GitHub events',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Github into the workflow. Can get get PR details, create PR comment, get repository info, and get latest commit. Can be used in trigger mode to trigger a workflow when a PR is created, commented on, or a commit is pushed.',
  docsLink: 'https://docs.sim.ai/tools/github',
  category: 'tools',
  bgColor: '#181C1E',
  icon: GithubIcon,
  triggerAllowed: true,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Get PR details', id: 'github_pr' },
        { label: 'Create PR comment', id: 'github_comment' },
        { label: 'Get repository info', id: 'github_repo_info' },
        { label: 'Get latest commit', id: 'github_latest_commit' },
      ],
      value: () => 'github_pr',
    },
    {
      id: 'owner',
      title: 'Repository Owner',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., microsoft',
      required: true,
    },
    {
      id: 'repo',
      title: 'Repository Name',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., vscode',
      required: true,
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., 123',
      condition: { field: 'operation', value: 'github_pr' },
      required: true,
    },
    {
      id: 'body',
      title: 'Comment',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter comment text',
      condition: { field: 'operation', value: 'github_comment' },
      required: true,
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., 123',
      condition: { field: 'operation', value: 'github_comment' },
      required: true,
    },
    {
      id: 'branch',
      title: 'Branch Name',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., main (leave empty for default)',
      condition: { field: 'operation', value: 'github_latest_commit' },
    },
    {
      id: 'apiKey',
      title: 'GitHub Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter GitHub Token',
      password: true,
      required: true,
    },
    // TRIGGER MODE: Trigger configuration (only shown when trigger mode is active)
    {
      id: 'triggerConfig',
      title: 'Trigger Configuration',
      type: 'trigger-config',
      layout: 'full',
      triggerProvider: 'github',
      availableTriggers: ['github_webhook'],
    },
    {
      id: 'commentType',
      title: 'Comment Type',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'General PR Comment', id: 'pr_comment' },
        { label: 'File-specific Comment', id: 'file_comment' },
      ],
      condition: { field: 'operation', value: 'github_comment' },
    },
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., src/main.ts',
      condition: {
        field: 'operation',
        value: 'github_comment',
        and: {
          field: 'commentType',
          value: 'file_comment',
        },
      },
    },
    {
      id: 'line',
      title: 'Line Number',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., 42',
      condition: {
        field: 'operation',
        value: 'github_comment',
        and: {
          field: 'commentType',
          value: 'file_comment',
        },
      },
    },
  ],
  tools: {
    access: ['github_pr', 'github_comment', 'github_repo_info', 'github_latest_commit'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'github_pr':
            return 'github_pr'
          case 'github_comment':
            return 'github_comment'
          case 'github_repo_info':
            return 'github_repo_info'
          case 'github_latest_commit':
            return 'github_latest_commit'
          default:
            return 'github_repo_info'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    owner: { type: 'string', description: 'Repository owner' },
    repo: { type: 'string', description: 'Repository name' },
    pullNumber: { type: 'number', description: 'Pull request number' },
    body: { type: 'string', description: 'Comment text' },
    apiKey: { type: 'string', description: 'GitHub access token' },
    commentType: { type: 'string', description: 'Comment type' },
    path: { type: 'string', description: 'File path' },
    line: { type: 'number', description: 'Line number' },
    side: { type: 'string', description: 'Comment side' },
    commitId: { type: 'string', description: 'Commit identifier' },
    branch: { type: 'string', description: 'Branch name' },
  },
  outputs: {
    content: { type: 'string', description: 'Response content' },
    metadata: { type: 'json', description: 'Response metadata' },
    // Trigger outputs
    action: { type: 'string', description: 'The action that was performed' },
    event_type: { type: 'string', description: 'Type of GitHub event' },
    repository: { type: 'string', description: 'Repository full name' },
    repository_name: { type: 'string', description: 'Repository name only' },
    repository_owner: { type: 'string', description: 'Repository owner username' },
    sender: { type: 'string', description: 'Username of the user who triggered the event' },
    sender_id: { type: 'string', description: 'User ID of the sender' },
    ref: { type: 'string', description: 'Git reference (for push events)' },
    before: { type: 'string', description: 'SHA of the commit before the push' },
    after: { type: 'string', description: 'SHA of the commit after the push' },
    commits: { type: 'string', description: 'Array of commit objects (for push events)' },
    pull_request: { type: 'string', description: 'Pull request object (for pull_request events)' },
    issue: { type: 'string', description: 'Issue object (for issues events)' },
    comment: { type: 'string', description: 'Comment object (for comment events)' },
    branch: { type: 'string', description: 'Branch name extracted from ref' },
    commit_message: { type: 'string', description: 'Latest commit message' },
    commit_author: { type: 'string', description: 'Author of the latest commit' },
  },
  triggers: {
    enabled: true,
    available: ['github_webhook'],
  },
}
