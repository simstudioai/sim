import { RootlyIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const rootlyConnectorMeta: ConnectorMeta = {
  id: 'rootly',
  name: 'Rootly',
  description: 'Sync incidents, postmortems, and timelines from Rootly',
  version: '1.0.0',
  icon: RootlyIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Rootly API key',
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'status',
      title: 'Filter by Status',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. resolved (default: all)',
      description: 'Only sync incidents with this status (e.g. resolved, mitigated, started).',
    },
    {
      id: 'severity',
      title: 'Filter by Severity',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. sev0 (default: all)',
      description:
        'Only sync incidents with this severity slug (e.g. sev0, sev1). Leave blank to sync all severities.',
    },
    {
      id: 'services',
      title: 'Filter by Services',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      multi: true,
      placeholder: 'Service slugs (comma-separated, default: all)',
      description: 'Only sync incidents affecting these service slugs.',
    },
    {
      id: 'teams',
      title: 'Filter by Teams',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      multi: true,
      placeholder: 'Team slugs (comma-separated, default: all)',
      description: 'Only sync incidents owned by these team slugs.',
    },
    {
      id: 'environments',
      title: 'Filter by Environments',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      multi: true,
      placeholder: 'Environment slugs (comma-separated, default: all)',
      description: 'Only sync incidents in these environment slugs.',
    },
    {
      id: 'maxIncidents',
      title: 'Max Incidents',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'severity', displayName: 'Severity', fieldType: 'text' },
    { id: 'kind', displayName: 'Kind', fieldType: 'text' },
    { id: 'services', displayName: 'Services', fieldType: 'text' },
    { id: 'teams', displayName: 'Teams', fieldType: 'text' },
    { id: 'environments', displayName: 'Environments', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'incidentDate', displayName: 'Incident Date', fieldType: 'date' },
    { id: 'resolvedDate', displayName: 'Resolved Date', fieldType: 'date' },
  ],
}
