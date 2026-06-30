import { GitLabIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const gitlabConnectorMeta: ConnectorMeta = {
  id: 'gitlab',
  name: 'GitLab',
  description:
    'Sync repository files, wiki pages, and issues from a GitLab project into your knowledge base',
  version: '1.0.0',
  icon: GitLabIcon,

  /**
   * Incremental sync applies to issues only (via the `updated_after` filter
   * derived from lastSyncAt). Wikis and repository files lack a change timestamp
   * on listing, so they are always re-listed in full and reconciled by content
   * hash (wiki: content digest, file: git blob SHA) — unchanged docs are skipped.
   */
  supportsIncrementalSync: true,

  auth: {
    mode: 'apiKey',
    label: 'Personal Access Token',
    placeholder: 'Enter your GitLab PAT',
  },

  configFields: [
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      placeholder: 'gitlab.com',
      required: false,
      description: 'Self-managed GitLab host. Leave blank for gitlab.com.',
    },
    {
      id: 'project',
      title: 'Project',
      type: 'short-input',
      placeholder: 'group/project or numeric ID',
      required: true,
      description: 'Project path (e.g. my-group/my-repo) or numeric project ID.',
    },
    {
      id: 'contentTypes',
      title: 'Content',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Code, Wiki & Issues', id: 'all' },
        { label: 'Code (repository files) only', id: 'repo' },
        { label: 'Wiki only', id: 'wiki' },
        { label: 'Issues only', id: 'issues' },
        { label: 'Wiki & Issues', id: 'both' },
      ],
      description: 'Which content to index. "Code" syncs repository files (READMEs, docs, source).',
    },
    {
      id: 'ref',
      title: 'Branch',
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
      id: 'issueState',
      title: 'Issue State',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Open only', id: 'opened' },
        { label: 'Closed only', id: 'closed' },
      ],
      description: 'Which issues to sync by state. Applies only when syncing issues.',
    },
    {
      id: 'issueLabels',
      title: 'Issue Labels',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. bug,docs (comma-separated)',
      description:
        'Only sync issues with all of these labels (comma-separated). Applies only when syncing issues.',
    },
    {
      id: 'issueMilestone',
      title: 'Issue Milestone',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. v1.0 (milestone title)',
      description:
        'Only sync issues assigned to this milestone (exact title). Applies only when syncing issues.',
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
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'author', displayName: 'Author', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'milestone', displayName: 'Milestone', fieldType: 'text' },
    { id: 'path', displayName: 'File Path', fieldType: 'text' },
    { id: 'size', displayName: 'File Size (bytes)', fieldType: 'number' },
    { id: 'createdAt', displayName: 'Created At', fieldType: 'date' },
    { id: 'updatedAt', displayName: 'Updated At', fieldType: 'date' },
  ],
}
