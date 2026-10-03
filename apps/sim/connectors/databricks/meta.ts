import { DatabricksIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

/** Default root of the notebook walk when the user leaves `rootPath` empty. */
export const DEFAULT_NOTEBOOK_ROOT_PATH = '/'

/** Content kinds this connector can index, keyed by the `contentType` config field. */
export const DATABRICKS_CONTENT_TYPES = {
  notebooks: 'notebooks',
  queries: 'queries',
} as const

export type DatabricksContentType =
  (typeof DATABRICKS_CONTENT_TYPES)[keyof typeof DATABRICKS_CONTENT_TYPES]

export const databricksConnectorMeta: ConnectorMeta = {
  id: 'databricks',
  name: 'Databricks',
  description: 'Sync notebooks and saved SQL queries from Databricks into your knowledge base',
  version: '1.0.0',
  icon: DatabricksIcon,

  auth: {
    mode: 'apiKey',
    label: 'Personal Access Token',
    placeholder: 'Enter your Databricks personal access token',
  },

  /**
   * `GET /api/2.0/workspace/list` documents `created_at`, `modified_at` and `size`
   * as "only applicable to files", so a `NOTEBOOK` entry can come back with no
   * change indicator at all. Its metadata-derived `contentHash` then stays
   * identical across edits and an incremental sync would never re-export it.
   * Opting into full-resync rehydration gives users a way to pick those edits up.
   */
  rehydrateOnFullSync: true,

  configFields: [
    {
      id: 'workspaceHost',
      title: 'Workspace Host',
      type: 'short-input',
      placeholder: 'dbc-1234abcd-5678.cloud.databricks.com',
      required: true,
      description:
        'Your per-workspace Databricks URL. Azure and GCP hosts (adb-*.azuredatabricks.net, *.gcp.databricks.com) are also accepted.',
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      required: true,
      description: 'What to sync from the workspace. Add a second connector to sync both.',
      options: [
        { label: 'Notebooks', id: DATABRICKS_CONTENT_TYPES.notebooks },
        { label: 'Saved SQL Queries', id: DATABRICKS_CONTENT_TYPES.queries },
      ],
    },
    {
      id: 'rootPath',
      title: 'Notebook Root Path',
      type: 'short-input',
      required: false,
      placeholder: '/Users/you@example.com (default: /)',
      description:
        'Absolute workspace path to walk for notebooks. Ignored when syncing saved SQL queries.',
    },
    {
      id: 'maxDocuments',
      title: 'Max Documents',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
      description: 'Cap the number of documents synced. Leave empty to sync everything.',
    },
  ],

  tagDefinitions: [
    { id: 'language', displayName: 'Language', fieldType: 'text' },
    { id: 'owner', displayName: 'Owner', fieldType: 'text' },
    { id: 'catalog', displayName: 'Catalog', fieldType: 'text' },
    { id: 'schema', displayName: 'Schema', fieldType: 'text' },
    { id: 'labels', displayName: 'Tags', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
