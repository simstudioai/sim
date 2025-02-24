import { GithubIcon } from '@/components/icons'
import { CreateCommentResponse, PullRequestResponse } from '@/tools/github/types'
import { BlockConfig } from '../types'

type GitHubResponse = PullRequestResponse | CreateCommentResponse

export const GitHubBlock: BlockConfig<GitHubResponse> = {
  type: 'github',
  name: 'GitHub',
  description: 'Interact with GitHub repositories and PRs',
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
        { label: 'Get repository info', id: 'github_repoinfo' },
      ],
      value: () => 'github_pr',
    },
    {
      id: 'owner',
      title: 'Repository Owner',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., microsoft',
    },
    {
      id: 'repo',
      title: 'Repository Name',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., vscode',
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., 123',
      condition: { field: 'operation', value: 'github_pr' },
    },
    {
      id: 'body',
      title: 'Comment',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter comment text',
      condition: { field: 'operation', value: 'github_comment' },
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      layout: 'half',
      placeholder: 'e.g., 123',
      condition: { field: 'operation', value: 'github_comment' },
    },
    {
      id: 'apiKey',
      title: 'GitHub Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter GitHub Token',
      password: true,
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
    access: ['github_pr', 'github_comment', 'github_repoinfo'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'github_pr':
            return 'github_pr'
          case 'github_comment':
            return 'github_comment'
          case 'github_repoinfo':
          default:
            return 'github_repoinfo'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    owner: { type: 'string', required: true },
    repo: { type: 'string', required: true },
    pullNumber: { type: 'number', required: false },
    body: { type: 'string', required: false },
    apiKey: { type: 'string', required: true },
    commentType: { type: 'string', required: false },
    path: { type: 'string', required: false },
    line: { type: 'number', required: false },
    side: { type: 'string', required: false },
    commitId: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        body: 'string',
        html_url: 'string',
        created_at: 'string',
        updated_at: 'string',
        number: 'number',
        title: 'string',
        state: 'string',
        diff_url: 'string',
        files: 'any',
        comments: 'any',
        id: 'number',
        path: 'any',
        line: 'any',
        side: 'any',
        commit_id: 'any',
      },
    },
  },
}
