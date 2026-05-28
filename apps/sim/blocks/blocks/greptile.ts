import { GreptileIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
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
  integrationType: IntegrationType.DevOps,
  bgColor: '#FFFFFF',
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

export const GreptileBlockMeta = {
  tags: ['version-control', 'knowledge-base'],
  templates: [
    {
      icon: GreptileIcon,
      title: 'Greptile code search',
      prompt:
        'Create a workflow exposed as a chat endpoint that accepts natural-language code questions, runs them against a Greptile-indexed repository, and returns the AI-generated answer with file and line citations so engineers get grounded answers about the codebase.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'research', 'devops'],
    },
    {
      icon: GreptileIcon,
      title: 'Greptile-backed PR reviewer',
      prompt:
        'Build a workflow that runs when a GitHub pull request is opened, fetches the diff, asks Greptile how each changed function is used elsewhere in the codebase, and posts an architectural review comment highlighting impact, downstream callers, and risky patterns.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: GreptileIcon,
      title: 'Onboarding doc generator',
      prompt:
        'Create a workflow that takes a repository name, indexes it with Greptile if not already indexed, then queries Greptile for the architecture overview, key modules, and entry points, and writes a polished onboarding document file new engineers can read on day one.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'content', 'team'],
    },
    {
      icon: GreptileIcon,
      title: 'Repository index orchestrator',
      prompt:
        'Create a scheduled workflow that runs nightly, lists every repository in a table, submits any newly created or updated repositories to Greptile for indexing, polls until indexing completes, and updates the table with index status and completion time.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'automation'],
    },
    {
      icon: GreptileIcon,
      title: 'Code search audit log',
      prompt:
        'Build a workflow that wraps Greptile queries with structured logging — capturing question, repository, top-matched files, and answer — into a tables-backed audit log so leadership can see what knowledge the team is searching for and where docs are weakest.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis', 'enterprise'],
    },
    {
      icon: GreptileIcon,
      title: 'Incident root-cause assistant',
      prompt:
        'Create a workflow triggered during an incident that takes the failing endpoint or stack frame, asks Greptile where the relevant code lives and what changed most recently, and posts a structured root-cause hypothesis with file links to the incident Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GreptileIcon,
      title: 'Greptile onboarding repo indexer',
      prompt:
        'Build a workflow that on a new repository indexes it with Greptile, then runs a set of architecture questions to generate a codebase overview — entry points, key services, and conventions — and writes the guide to a file for new engineers.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'content', 'automation'],
    },
  ],
} as const satisfies BlockMeta
