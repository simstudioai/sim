import { AirtableIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const airtableConnectorMeta: ConnectorMeta = {
  id: 'airtable',
  name: 'Airtable',
  description: 'Sync records from an Airtable table',
  version: '1.0.0',
  icon: AirtableIcon,

  auth: {
    mode: 'oauth',
    provider: 'airtable',
    requiredScopes: ['data.records:read', 'schema.bases:read'],
  },

  configFields: [
    {
      id: 'baseSelector',
      title: 'Base',
      type: 'selector',
      selectorKey: 'airtable.bases',
      canonicalParamId: 'baseId',
      mode: 'basic',
      placeholder: 'Select a base',
      required: true,
    },
    {
      id: 'baseId',
      title: 'Base ID',
      type: 'short-input',
      canonicalParamId: 'baseId',
      mode: 'advanced',
      placeholder: 'e.g. appXXXXXXXXXXXXXX',
      required: true,
    },
    {
      id: 'tableSelector',
      title: 'Table',
      type: 'selector',
      selectorKey: 'airtable.tables',
      canonicalParamId: 'tableIdOrName',
      mode: 'basic',
      dependsOn: ['baseSelector'],
      placeholder: 'Select a table',
      required: true,
    },
    {
      id: 'tableIdOrName',
      title: 'Table Name or ID',
      type: 'short-input',
      canonicalParamId: 'tableIdOrName',
      mode: 'advanced',
      placeholder: 'e.g. Tasks or tblXXXXXXXXXXXXXX',
      required: true,
    },
    {
      id: 'viewId',
      title: 'View',
      type: 'short-input',
      placeholder: 'e.g. Grid view or viwXXXXXXXXXXXXXX',
      required: false,
    },
    {
      id: 'titleField',
      title: 'Title Field',
      type: 'short-input',
      placeholder: 'e.g. Name',
      required: false,
    },
    {
      id: 'maxRecords',
      title: 'Max Records',
      type: 'short-input',
      placeholder: 'e.g. 1000 (default: unlimited)',
      required: false,
    },
  ],

  tagDefinitions: [{ id: 'createdTime', displayName: 'Created Time', fieldType: 'date' }],
}
