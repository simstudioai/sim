import { IncidentioIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const incidentioConnectorMeta: ConnectorMeta = {
  id: 'incidentio',
  name: 'incident.io',
  description: 'Sync incidents and postmortems from incident.io into your knowledge base',
  version: '1.0.0',
  icon: IncidentioIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your incident.io API key',
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'statusCategory',
      title: 'Status Category',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'All except canceled (default)', id: '' },
        { label: 'All (including canceled)', id: 'all' },
        { label: 'Live (active)', id: 'live' },
        { label: 'Paused', id: 'paused' },
        { label: 'Closed', id: 'closed' },
        { label: 'Triage', id: 'triage' },
        { label: 'Learning (post-incident)', id: 'learning' },
        { label: 'Declined', id: 'declined' },
        { label: 'Merged', id: 'merged' },
        { label: 'Canceled', id: 'canceled' },
      ],
      description:
        'Only sync incidents in this status category. The default skips canceled incidents, which is how incident.io hides an incident since it has no delete. Choose "All (including canceled)" to sync every category.',
    },
    {
      id: 'mode',
      title: 'Mode',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'All', id: '' },
        { label: 'Standard (real incidents)', id: 'standard' },
        { label: 'Retrospective', id: 'retrospective' },
        { label: 'Test', id: 'test' },
        { label: 'Tutorial', id: 'tutorial' },
      ],
      description:
        'Only sync incidents of this mode. Use Standard to exclude test/tutorial incidents.',
    },
    {
      id: 'maxIncidents',
      title: 'Max Incidents',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
      description: 'Cap the number of incidents synced. Leave empty to sync all incidents.',
    },
  ],

  tagDefinitions: [
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'statusCategory', displayName: 'Status Category', fieldType: 'text' },
    { id: 'severity', displayName: 'Severity', fieldType: 'text' },
    { id: 'incidentType', displayName: 'Incident Type', fieldType: 'text' },
    { id: 'mode', displayName: 'Mode', fieldType: 'text' },
    { id: 'visibility', displayName: 'Visibility', fieldType: 'text' },
    { id: 'incidentDate', displayName: 'Incident Date', fieldType: 'date' },
    { id: 'reportedBy', displayName: 'Reported By', fieldType: 'text' },
  ],
}
