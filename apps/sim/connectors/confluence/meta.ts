import { ConfluenceIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const confluenceConnectorMeta: ConnectorMeta = {
  id: 'confluence',
  name: 'Confluence',
  description: 'Sync pages from a Confluence space',
  version: '1.1.0',
  icon: ConfluenceIcon,

  auth: {
    mode: 'oauth',
    provider: 'confluence',
    requiredScopes: [
      'read:confluence-content.all',
      'read:page:confluence',
      'read:blogpost:confluence',
      'read:space:confluence',
      'read:label:confluence',
      'search:confluence',
      'offline_access',
    ],
  },

  /**
   * Confluence pages can transclude other pages (Include Page / Excerpt macros).
   * Editing an included page changes a container page's rendered `view` without
   * bumping the container's version, so its version-based hash can't detect the
   * change. A full resync re-hydrates and re-indexes to pick up that drift. This
   * lives on the meta so the client can offer "Full resync" only where it applies.
   */
  rehydrateOnFullSync: true,

  configFields: [
    {
      id: 'domain',
      title: 'Confluence Domain',
      type: 'short-input',
      placeholder: 'yoursite.atlassian.net',
      required: true,
    },
    {
      id: 'spaceSelector',
      title: 'Spaces',
      type: 'selector',
      selectorKey: 'confluence.spaces',
      canonicalParamId: 'spaceKey',
      mode: 'basic',
      multi: true,
      dependsOn: ['domain'],
      placeholder: 'Select one or more spaces',
      required: true,
    },
    {
      id: 'spaceKey',
      title: 'Space Keys',
      type: 'short-input',
      canonicalParamId: 'spaceKey',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. ENG, PRODUCT (comma-separated for multiple)',
      required: true,
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Pages only', id: 'page' },
        { label: 'Blog posts only', id: 'blogpost' },
        { label: 'All content', id: 'all' },
      ],
    },
    {
      id: 'labelFilter',
      title: 'Filter by Label',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. published, engineering',
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
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'version', displayName: 'Version', fieldType: 'number' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
