import { GitLabIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const gitlabConnectorMeta: ConnectorMeta = {
  search: true,
  searchDocsUrl: 'https://docs.sim.ai/search/gitlab',
  id: 'gitlab',
  name: 'GitLab',
  description:
    'Sync repository files, wiki pages, issues, merge requests, and their non-internal comments from a GitLab project',
  version: '1.3.0',
  mirrorsSourceAcls: true,
  adminSetupHint:
    'Use a self-managed GitLab instance administrator token with read_api access (and admin_mode when required). Enter your instance host.',
  icon: GitLabIcon,

  /**
   * Comment edits/deletes have their own timestamps; the provider does not
   * promise to advance the parent issue/MR timestamp for every change. Full
   * listings and deferred comment hydration keep both content and permissions
   * current. Content hashes avoid embedding unchanged documents.
   */
  supportsIncrementalSync: false,

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
      placeholder: 'gitlab.example.com',
      required: false,
      requiredInAdminMode: true,
      description: 'Your GitLab instance host. Sim Search requires a self-managed instance.',
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
        { label: 'Code, Wiki, Issues & Merge Requests', id: 'all' },
        { label: 'Code (repository files) only', id: 'repo' },
        { label: 'Wiki only', id: 'wiki' },
        { label: 'Issues only', id: 'issues' },
        { label: 'Merge Requests only', id: 'merge_requests' },
        { label: 'Wiki & Issues', id: 'both' },
      ],
      placeholder: 'Wiki & Issues',
      description:
        'Issues and merge requests include non-internal comments. "Code" syncs text repository files. Defaults to Wiki & Issues when left unset.',
    },
    {
      id: 'ref',
      setupGroup: 'options',
      title: 'Branch',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Default branch',
      description: 'Branch or tag to sync repository files from. Applies only when syncing Code.',
    },
    {
      id: 'pathPrefix',
      setupGroup: 'options',
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
      setupGroup: 'options',
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
      setupGroup: 'options',
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
      setupGroup: 'options',
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
      setupGroup: 'options',
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
      setupGroup: 'options',
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
