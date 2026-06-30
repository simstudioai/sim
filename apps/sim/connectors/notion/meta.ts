import { NotionIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const notionConnectorMeta: ConnectorMeta = {
  id: 'notion',
  name: 'Notion',
  description: 'Sync pages from a Notion workspace',
  version: '1.0.0',
  icon: NotionIcon,

  auth: { mode: 'oauth', provider: 'notion', requiredScopes: [] },

  configFields: [
    {
      id: 'scope',
      title: 'Sync Scope',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Entire workspace', id: 'workspace' },
        { label: 'Specific database', id: 'database' },
        { label: 'Specific page (and children)', id: 'page' },
      ],
    },
    {
      id: 'databaseSelector',
      title: 'Databases',
      type: 'selector',
      selectorKey: 'notion.databases',
      canonicalParamId: 'databaseId',
      mode: 'basic',
      multi: true,
      placeholder: 'Select one or more databases',
      required: false,
    },
    {
      id: 'databaseId',
      title: 'Database IDs',
      type: 'short-input',
      canonicalParamId: 'databaseId',
      mode: 'advanced',
      multi: true,
      required: false,
      placeholder: 'e.g. 8a3b5f6e-..., 9c4d6e7f-... (comma-separated for multiple)',
    },
    {
      id: 'rootPageSelector',
      title: 'Page',
      type: 'selector',
      selectorKey: 'notion.pages',
      canonicalParamId: 'rootPageId',
      mode: 'basic',
      placeholder: 'Select a page',
      required: false,
    },
    {
      id: 'rootPageId',
      title: 'Page ID',
      type: 'short-input',
      canonicalParamId: 'rootPageId',
      mode: 'advanced',
      required: false,
      placeholder: 'e.g. 8a3b5f6e-1234-5678-abcd-ef0123456789',
    },
    {
      id: 'searchQuery',
      title: 'Search Filter',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. meeting notes, project plan',
    },
    {
      id: 'maxPages',
      title: 'Max Pages',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'created', displayName: 'Created', fieldType: 'date' },
  ],
}
