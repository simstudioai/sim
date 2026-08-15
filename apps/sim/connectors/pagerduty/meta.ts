import { PagerDutyIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const pagerdutyConnectorMeta: ConnectorMeta = {
  id: 'pagerduty',
  name: 'PagerDuty',
  description: 'Sync incidents, notes, and response timelines from PagerDuty',
  version: '1.0.0',
  icon: PagerDutyIcon,

  auth: {
    mode: 'apiKey',
    label: 'REST API Key',
    placeholder: 'Enter your PagerDuty REST API key',
  },

  /**
   * Deliberately absent. PagerDuty's `since`/`until` filter incident *creation*
   * time, and the REST API exposes no modified-since filter, so an incremental
   * listing would never surface a status change, a new note, or a resolution on
   * an incident created before the window — an incident synced while triggered
   * would stay triggered forever. Every sync therefore lists the full history,
   * gated by `contentHash` so unchanged incidents are never re-hydrated.
   */

  configFields: [
    {
      id: 'statuses',
      title: 'Status',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'All (default)', id: '' },
        { label: 'Triggered', id: 'triggered' },
        { label: 'Acknowledged', id: 'acknowledged' },
        { label: 'Resolved', id: 'resolved' },
      ],
      description: 'Only sync incidents in this status. Leave on All to sync every status.',
    },
    {
      id: 'urgency',
      title: 'Urgency',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'All (default)', id: '' },
        { label: 'High', id: 'high' },
        { label: 'Low', id: 'low' },
      ],
      description: 'Only sync incidents at this urgency. Requires the urgencies ability.',
    },
    {
      id: 'serviceIds',
      title: 'Filter by Services',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      multi: true,
      placeholder: 'Service IDs (comma-separated, default: all)',
      description: 'Only sync incidents on these PagerDuty service IDs (e.g. PIJ90N7).',
    },
    {
      id: 'teamIds',
      title: 'Filter by Teams',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      multi: true,
      placeholder: 'Team IDs (comma-separated, default: all)',
      description:
        'Only sync incidents owned by these PagerDuty team IDs. Requires the teams ability.',
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
    { id: 'urgency', displayName: 'Urgency', fieldType: 'text' },
    { id: 'priority', displayName: 'Priority', fieldType: 'text' },
    { id: 'service', displayName: 'Service', fieldType: 'text' },
    { id: 'teams', displayName: 'Teams', fieldType: 'text' },
    { id: 'incidentType', displayName: 'Incident Type', fieldType: 'text' },
    { id: 'incidentDate', displayName: 'Incident Date', fieldType: 'date' },
    { id: 'resolvedDate', displayName: 'Resolved Date', fieldType: 'date' },
    { id: 'incidentNumber', displayName: 'Incident Number', fieldType: 'number' },
  ],
}
