import { GreptileIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

/** Shared by the two repository operations, which both take a branch. */
const ON_BRANCH = { text: 'on branch', field: 'branch' } as const

export const GreptileBlock: BlockConfig = {
  type: 'greptile',
  name: 'Greptile',
  description: 'Index repositories and check indexing status with Greptile',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Index repositories with Greptile and check their indexing status. Greptile has retired its natural-language query and search endpoints, so the Query operation is no longer offered.',
  docsLink: 'https://docs.sim.ai/integrations/greptile',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#181C1E',
  icon: GreptileIcon,
  canvasPresentation: {
    defaultTitle: 'Greptile',
    sentences: {
      byOperation: {
        greptile_query: [
          { text: 'Query', field: 'repositories', after: 'for', core: true },
          { field: 'query', core: true },
        ],
        greptile_index_repo: [{ text: 'Index', field: 'repository', core: true }, ON_BRANCH],
        greptile_status: [
          { text: 'Check indexing status of', field: 'repository', core: true },
          ON_BRANCH,
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Greptile removed POST /v2/query (404 unknown_endpoint) with no documented replacement;
        // kept hidden so saved blocks stay valid.
        { label: 'Query', id: 'greptile_query', hidden: true },
        { label: 'Index Repository', id: 'greptile_index_repo' },
        { label: 'Check Status', id: 'greptile_status' },
      ],
      value: () => 'greptile_index_repo',
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
    // Index & Status shared inputs
    {
      id: 'remote',
      title: 'Git Remote',
      type: 'dropdown',
      options: [
        { label: 'GitHub', id: 'github' },
        { label: 'GitLab', id: 'gitlab' },
      ],
      value: () => 'github',
      condition: { field: 'operation', value: ['greptile_index_repo', 'greptile_status'] },
    },
    {
      id: 'repository',
      title: 'Repository',
      type: 'short-input',
      placeholder: 'owner/repo',
      condition: { field: 'operation', value: ['greptile_index_repo', 'greptile_status'] },
      required: true,
    },
    {
      id: 'branch',
      title: 'Branch',
      type: 'short-input',
      placeholder: 'main',
      condition: { field: 'operation', value: ['greptile_index_repo', 'greptile_status'] },
      required: true,
    },
    // Index-only inputs
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
    access: ['greptile_query', 'greptile_index_repo', 'greptile_status'],
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

export const GreptileBlockMeta = {
  tags: ['version-control', 'knowledge-base'],
  url: 'https://www.greptile.com',
  skills: [
    {
      name: 'index-and-verify-repo',
      description: 'Trigger Greptile indexing for a repository and poll until indexing completes.',
      content:
        '# Index and Verify Repo\n\nIndex a repository in Greptile.\n\n## Steps\n1. Start indexing for the repository, specifying the remote, owner/repo, and branch.\n2. Poll the index status until it reports completed or fails.\n3. On failure, report the error and the branch/remote used so it can be corrected.\n4. On success, report the files processed and the commit SHA that was indexed.\n\n## Output\nReturn the final index status, the branch indexed, and the files processed.',
    },
  ],
} as const satisfies BlockMeta
