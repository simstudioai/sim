import { GreptileIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GreptileResponse } from '@/tools/greptile/types'

export const GreptileBlock: BlockConfig<GreptileResponse> = {
  type: 'greptile',
  name: 'Greptile',
  description: 'AI-powered codebase search and Q&A',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Query and search codebases using natural language with Greptile. Get AI-generated answers about your code, find relevant files, and understand complex codebases.',
  docsLink: 'https://docs.sim.ai/tools/greptile',
  category: 'tools',
  bgColor: '#e5e5e5',
  icon: GreptileIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Query', id: 'greptile_query' },
        // { label: 'Search', id: 'greptile_search' }, // Disabled: Greptile search endpoint returning v1 deprecation error
        { label: 'Index Repository', id: 'greptile_index_repo' },
        { label: 'Check Status', id: 'greptile_status' },
      ],
      value: () => 'greptile_query',
    },
    // Query operation inputs
    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'Ask a question about the codebase...',
      condition: { field: 'operation', value: 'greptile_query' },
      required: true,
    },
    {
      id: 'repositories',
      title: 'Repositories',
      type: 'long-input',
      placeholder: 'owner/repo, github:main:owner/repo (comma-separated)',
      condition: { field: 'operation', value: 'greptile_query' },
      required: true,
    },
    {
      id: 'sessionId',
      title: 'Session ID',
      type: 'short-input',
      placeholder: 'Optional session ID for conversation continuity',
      condition: { field: 'operation', value: 'greptile_query' },
    },
    {
      id: 'genius',
      title: 'Genius Mode',
      type: 'switch',
      condition: { field: 'operation', value: 'greptile_query' },
    },
    // Search operation inputs - Disabled: Greptile search endpoint returning v1 deprecation error
    // {
    //   id: 'query',
    //   title: 'Search Query',
    //   type: 'long-input',
    //   placeholder: 'Search for code patterns, functions, or concepts...',
    //   condition: { field: 'operation', value: 'greptile_search' },
    //   required: true,
    // },
    // {
    //   id: 'repositories',
    //   title: 'Repositories',
    //   type: 'long-input',
    //   placeholder: 'owner/repo, github:main:owner/repo (comma-separated)',
    //   condition: { field: 'operation', value: 'greptile_search' },
    //   required: true,
    // },
    // {
    //   id: 'sessionId',
    //   title: 'Session ID',
    //   type: 'short-input',
    //   placeholder: 'Optional session ID for conversation continuity',
    //   condition: { field: 'operation', value: 'greptile_search' },
    // },
    // {
    //   id: 'genius',
    //   title: 'Genius Mode',
    //   type: 'switch',
    //   condition: { field: 'operation', value: 'greptile_search' },
    // },
    // Index operation inputs
    {
      id: 'remote',
      title: 'Git Remote',
      type: 'dropdown',
      options: [
        { label: 'GitHub', id: 'github' },
        { label: 'GitLab', id: 'gitlab' },
      ],
      value: () => 'github',
      condition: { field: 'operation', value: 'greptile_index_repo' },
    },
    {
      id: 'repository',
      title: 'Repository',
      type: 'short-input',
      placeholder: 'owner/repo',
      condition: { field: 'operation', value: 'greptile_index_repo' },
      required: true,
    },
    {
      id: 'branch',
      title: 'Branch',
      type: 'short-input',
      placeholder: 'main',
      condition: { field: 'operation', value: 'greptile_index_repo' },
      required: true,
    },
    {
      id: 'reload',
      title: 'Force Re-index',
      type: 'switch',
      condition: { field: 'operation', value: 'greptile_index_repo' },
    },
    {
      id: 'notify',
      title: 'Email Notification',
      type: 'switch',
      condition: { field: 'operation', value: 'greptile_index_repo' },
    },
    // Status operation inputs
    {
      id: 'remote',
      title: 'Git Remote',
      type: 'dropdown',
      options: [
        { label: 'GitHub', id: 'github' },
        { label: 'GitLab', id: 'gitlab' },
      ],
      value: () => 'github',
      condition: { field: 'operation', value: 'greptile_status' },
    },
    {
      id: 'repository',
      title: 'Repository',
      type: 'short-input',
      placeholder: 'owner/repo',
      condition: { field: 'operation', value: 'greptile_status' },
      required: true,
    },
    {
      id: 'branch',
      title: 'Branch',
      type: 'short-input',
      placeholder: 'main',
      condition: { field: 'operation', value: 'greptile_status' },
      required: true,
    },
    // API Keys (common)
    {
      id: 'apiKey',
      title: 'Greptile API Key',
      type: 'short-input',
      placeholder: 'Enter your Greptile API key',
      password: true,
      required: true,
    },
    {
      id: 'githubToken',
      title: 'GitHub Token',
      type: 'short-input',
      placeholder: 'Enter your GitHub Personal Access Token',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['greptile_query', /* 'greptile_search', */ 'greptile_index_repo', 'greptile_status'],
    config: {
      tool: (params) => params.operation,
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Greptile API key' },
    githubToken: { type: 'string', description: 'GitHub Personal Access Token' },
    // Query/Search inputs
    query: { type: 'string', description: 'Natural language query or search term' },
    repositories: { type: 'string', description: 'Comma-separated list of repositories' },
    sessionId: { type: 'string', description: 'Session ID for conversation continuity' },
    genius: { type: 'boolean', description: 'Enable genius mode for more thorough analysis' },
    // Index/Status inputs
    remote: { type: 'string', description: 'Git remote type (github/gitlab)' },
    repository: { type: 'string', description: 'Repository in owner/repo format' },
    branch: { type: 'string', description: 'Branch name' },
    reload: { type: 'boolean', description: 'Force re-indexing' },
    notify: { type: 'boolean', description: 'Send email notification' },
  },
  outputs: {
    // Query output
    message: { type: 'string', description: 'AI-generated answer to the query' },
    // Query/Search output
    sources: {
      type: 'json',
      description: 'Relevant code references with filepath, line numbers, and summary',
    },
    // Index output
    repositoryId: {
      type: 'string',
      description: 'Repository identifier (format: remote:branch:owner/repo)',
    },
    statusEndpoint: { type: 'string', description: 'URL endpoint to check indexing status' },
    // Status output
    status: {
      type: 'string',
      description: 'Indexing status: submitted, cloning, processing, completed, or failed',
    },
    private: { type: 'boolean', description: 'Whether the repository is private' },
    filesProcessed: { type: 'number', description: 'Number of files processed' },
    numFiles: { type: 'number', description: 'Total number of files' },
    sampleQuestions: { type: 'json', description: 'Sample questions for the indexed repository' },
    sha: { type: 'string', description: 'Git commit SHA' },
  },
}
