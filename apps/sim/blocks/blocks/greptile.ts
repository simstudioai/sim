import { ClipboardList } from '@sim/emcn/icons'
import { GreptileIcon, SlackIcon } from '@/components/icons'
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
  docsLink: 'https://docs.sim.ai/integrations/greptile',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#181C1E',
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
  url: 'https://www.greptile.com',
  templates: [
    {
      icon: SlackIcon,
      title: 'Slack code Q&A bot',
      prompt:
        'Build a workflow that monitors a Slack channel for code questions, routes them to Greptile against the relevant repository, and replies in-thread with the answer and the cited files.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GreptileIcon,
      title: 'Onboarding codebase explainer',
      prompt:
        'Create a workflow where a new engineer asks how a part of the codebase works, Greptile answers against the indexed repository with cited files, and the explanation is saved to a Google Doc.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'onboarding'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: ClipboardList,
      title: 'PR review with codebase context',
      prompt:
        'Build a workflow that takes a pull request, asks Greptile how the changed code interacts with the rest of the repository, and writes a review comment summarizing impact and risks with cited files.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'code-review'],
      alsoIntegrations: ['github'],
    },
  ],
  skills: [
    {
      name: 'answer-codebase-question',
      description:
        'Ask Greptile a natural-language question about an indexed repository and return a cited answer.',
      content:
        '# Answer Codebase Question\n\nGet an accurate, source-cited answer about how a codebase works.\n\n## Steps\n1. Confirm the repository is indexed by checking its index status; if not ready, index it first and wait.\n2. Query Greptile with the natural-language question (e.g. how authentication flows, where payments are processed).\n3. Capture the answer along with the file and function references it cites.\n4. If the answer is vague, refine the question with more specifics and re-query.\n\n## Output\nReturn the answer plus a list of cited files and symbols. Useful for onboarding, debugging, and understanding unfamiliar code.',
    },
    {
      name: 'review-pull-request',
      description:
        'Use Greptile to assess how a PR diff interacts with the rest of the repo and draft review notes.',
      content:
        '# Review Pull Request\n\nProduce a codebase-aware review of a set of changes.\n\n## Steps\n1. Ensure the repository is indexed (check status, index if needed).\n2. Query Greptile describing the changed files and ask how they interact with the rest of the codebase, what might break, and what edge cases to test.\n3. Collect the impact analysis and the cited files affected beyond the diff.\n4. Organize findings into bugs/risks, style/consistency, and suggested tests.\n\n## Output\nReturn structured review notes grouped by severity, each with the cited file and a concrete suggestion. Ready to post as a PR comment.',
    },
    {
      name: 'index-and-verify-repo',
      description:
        'Trigger Greptile indexing for a repository and poll until it is ready to query.',
      content:
        '# Index and Verify Repo\n\nMake a repository queryable in Greptile.\n\n## Steps\n1. Start indexing for the repository, specifying the remote, owner/repo, and branch.\n2. Poll the index status until it reports completed or fails.\n3. On failure, report the error and the branch/remote used so it can be corrected.\n4. On success, run a quick sanity query to confirm answers come back with citations.\n\n## Output\nReturn the final index status, the branch indexed, and the result of the sanity query. Confirms the repo is ready for codebase questions and reviews.',
    },
  ],
} as const satisfies BlockMeta
