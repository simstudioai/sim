import { AzureIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const azureDevopsConnectorMeta: ConnectorMeta = {
  id: 'azure_devops',
  name: 'Azure DevOps',
  description:
    'Sync wiki pages, work items, and repository files from an Azure DevOps project into your knowledge base',
  version: '1.1.0',
  icon: AzureIcon,

  auth: {
    mode: 'apiKey',
    label: 'Personal Access Token',
    placeholder: 'Enter your Azure DevOps PAT (scopes: Wiki Read, Work Items Read, Code Read)',
  },

  /**
   * Incremental sync applies to work items only, via a `System.ChangedDate`
   * WIQL filter derived from lastSyncAt. Wiki pages have no change timestamp on
   * listing, so they are always re-listed and reconciled by ETag content hash.
   * Repository files are likewise always re-listed in full and reconciled by the
   * git blob objectId hash — a commit-diff incremental path is intentionally
   * avoided to match the github/gitlab full-listing approach, keeping change
   * detection correct without tracking per-branch commit state. Unchanged
   * documents are skipped without a content fetch in every case.
   */
  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'organization',
      title: 'Organization',
      type: 'short-input',
      placeholder: 'e.g. my-org',
      required: true,
    },
    {
      id: 'project',
      title: 'Project',
      type: 'short-input',
      placeholder: 'e.g. my-project',
      required: true,
    },
    {
      id: 'contentType',
      title: 'Content',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Wiki pages only', id: 'wiki' },
        { label: 'Work items only', id: 'workitems' },
        { label: 'Repository files only', id: 'files' },
        { label: 'Wiki pages and work items', id: 'both' },
        { label: 'Wiki, work items, and files', id: 'all' },
      ],
      description: 'Which content to index from the project.',
    },
    {
      id: 'wikiName',
      title: 'Wiki',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Wiki name or ID (all wikis if blank)',
      description:
        'Restrict syncing to a single wiki by name or ID. Applies only when syncing wiki pages.',
    },
    {
      id: 'workItemType',
      title: 'Work Item Type',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. Bug, Task, User Story',
      description: 'Only sync work items of this type. Applies only when syncing work items.',
    },
    {
      id: 'state',
      title: 'State',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. Active, Closed',
      description: 'Only sync work items in this state. Applies only when syncing work items.',
    },
    {
      id: 'areaPath',
      title: 'Area Path',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. MyProject\\Team A',
      description:
        'Only sync work items under this area path (and its children). Applies only when syncing work items.',
    },
    {
      id: 'workItemTags',
      title: 'Tags',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. customer, urgent (comma-separated)',
      description:
        'Only sync work items containing all of these tags (comma-separated). Applies only when syncing work items.',
    },
    {
      id: 'customWiql',
      title: 'Custom WIQL Query',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'SELECT [System.Id] FROM workitems WHERE ...',
      description:
        'Advanced: a full WIQL query selecting [System.Id]. Overrides the type, state, area path, and tag filters when set. Custom queries always run as full listings on every sync (the incremental changed-date filter is not applied).',
    },
    {
      id: 'repositoryName',
      title: 'Repository',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Repository name or ID (all repos if blank)',
      description:
        'Restrict syncing to a single repository by name or ID. Applies only when syncing repository files.',
    },
    {
      id: 'branch',
      title: 'Branch',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: "Each repo's default branch",
      description:
        'Branch to sync repository files from. Defaults to each repository’s default branch. Applies only when syncing repository files.',
    },
    {
      id: 'pathPrefix',
      title: 'Path Filter',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. docs/, src/',
      description:
        'Only sync repository files under this path prefix. Applies only when syncing repository files.',
    },
    {
      id: 'fileExtensions',
      title: 'File Extensions',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. .md, .txt, .ts',
      description:
        'Only sync repository files with these extensions (comma-separated). Leave blank for all text files. Applies only when syncing repository files.',
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
    { id: 'kind', displayName: 'Type', fieldType: 'text' },
    { id: 'wikiName', displayName: 'Wiki', fieldType: 'text' },
    { id: 'workItemType', displayName: 'Work Item Type', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'areaPath', displayName: 'Area Path', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'repository', displayName: 'Repository', fieldType: 'text' },
    { id: 'path', displayName: 'File Path', fieldType: 'text' },
    { id: 'changedDate', displayName: 'Changed Date', fieldType: 'date' },
  ],
}
