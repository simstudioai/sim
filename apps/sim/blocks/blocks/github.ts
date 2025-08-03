import { GithubIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { GitHubResponse } from '@/tools/github/types'

export const GitHubBlock: BlockConfig<GitHubResponse> = {
  type: 'github',
  name: 'GitHub',
  description: 'Interact with GitHub',
  longDescription:
    'Access GitHub repositories, pull requests, and comments through the GitHub API. Automate code reviews, PR management, and repository interactions within your workflow.',
  docsLink: 'https://docs.sim.ai/tools/github',
  category: 'tools',
  bgColor: '#181C1E',
  icon: GithubIcon,
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
  },
}
