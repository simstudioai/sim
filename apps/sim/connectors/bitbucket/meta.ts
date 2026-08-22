import { BitbucketIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const bitbucketConnectorMeta: ConnectorMeta = {
  id: 'bitbucket',
  name: 'Bitbucket',
  description:
    'Sync repository files and pull request descriptions from a Bitbucket Cloud repository into your knowledge base',
  version: '1.0.0',
  icon: BitbucketIcon,

  /**
   * Deliberately disabled. Incremental sync would only ever apply to pull requests,
   * via a BBQL `q=updated_on > <timestamp>` filter derived from lastSyncAt; repository
   * files carry no per-file change timestamp in the source listing and are always
   * re-listed in full regardless. The sync engine disables deletion reconciliation for
   * every incremental run, so declaring support would leave files deleted upstream
   * indexed indefinitely on the default `code` configuration -- a complete listing whose
   * deletions are never applied. Re-listing pull requests in full each run is the
   * cheaper tradeoff.
   */
  supportsIncrementalSync: false,

  /**
   * Bitbucket Cloud REST API 2.0 authenticates with an OAuth 2.0 bearer token, the
   * same credential the Bitbucket tools and selectors already use. The scopes named
   * here are the ones Sim's Bitbucket OAuth service already requests
   * (`lib/oauth/oauth.ts`); the connector deliberately indexes nothing that would
   * need a scope outside that set.
   */
  auth: {
    mode: 'oauth',
    provider: 'bitbucket',
    requiredScopes: ['pullrequest'],
  },

  configFields: [
    {
      id: 'workspaceSelector',
      title: 'Workspace',
      type: 'selector',
      selectorKey: 'bitbucket.workspaces',
      canonicalParamId: 'workspaceSlug',
      mode: 'basic',
      placeholder: 'Select a workspace',
      required: true,
    },
    {
      id: 'workspaceSlug',
      title: 'Workspace Slug',
      type: 'short-input',
      canonicalParamId: 'workspaceSlug',
      mode: 'advanced',
      placeholder: 'e.g. my-team',
      required: true,
      description: 'Workspace ID (slug) or workspace UUID in curly braces.',
    },
    {
      id: 'repoSelector',
      title: 'Repository',
      type: 'selector',
      selectorKey: 'bitbucket.repositories',
      canonicalParamId: 'repoSlug',
      mode: 'basic',
      dependsOn: ['workspaceSelector'],
      placeholder: 'Select a repository',
      required: true,
    },
    {
      id: 'repoSlug',
      title: 'Repository Slug',
      type: 'short-input',
      canonicalParamId: 'repoSlug',
      mode: 'advanced',
      placeholder: 'e.g. my-repo',
      required: true,
      description: 'Repository slug or repository UUID in curly braces.',
    },
    {
      id: 'contentTypes',
      title: 'Content',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Code (repository files) only', id: 'code' },
        { label: 'Pull requests only', id: 'pullrequests' },
        { label: 'Code & Pull Requests', id: 'all' },
      ],
      placeholder: 'Code (repository files) only',
      description:
        'Which content to index. Defaults to repository files when left unset. Git LFS-managed files, Bitbucket Cloud wikis, and the issue tracker are not indexed.',
    },
    {
      id: 'ref',
      title: 'Branch or Tag',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Default branch',
      description: 'Branch or tag to sync repository files from. Applies only when syncing Code.',
    },
    {
      id: 'pathPrefix',
      title: 'Path Filter',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. docs/',
      description:
        'Only sync repository files under this path prefix. Applies only when syncing Code.',
    },
    {
      id: 'fileExtensions',
      title: 'File Extensions',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. .md, .txt, .mdx',
      description:
        'Only sync repository files with these extensions (comma-separated). Leave blank for all text files. Applies only when syncing Code.',
    },
    {
      id: 'pullRequestState',
      title: 'Pull Request State',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Open only', id: 'open' },
        { label: 'Merged only', id: 'merged' },
        { label: 'Open & Merged', id: 'openMerged' },
        { label: 'All', id: 'all' },
      ],
      description: 'Which pull requests to sync by state. Applies only when syncing pull requests.',
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'contentType', displayName: 'Content Type', fieldType: 'text' },
    { id: 'title', displayName: 'Title', fieldType: 'text' },
    { id: 'repository', displayName: 'Repository', fieldType: 'text' },
    { id: 'path', displayName: 'File Path', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'author', displayName: 'Author', fieldType: 'text' },
    { id: 'size', displayName: 'File Size (bytes)', fieldType: 'number' },
    { id: 'createdAt', displayName: 'Created At', fieldType: 'date' },
    { id: 'updatedAt', displayName: 'Updated At', fieldType: 'date' },
  ],
}
