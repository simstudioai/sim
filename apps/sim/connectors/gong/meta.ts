import { GongIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const gongConnectorMeta: ConnectorMeta = {
  id: 'gong',
  name: 'Gong',
  description: 'Sync call transcripts from Gong revenue intelligence',
  version: '1.0.0',
  icon: GongIcon,

  auth: {
    mode: 'apiKey',
    label: 'Access Key & Secret',
    placeholder: 'accessKey:accessKeySecret',
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'lookback',
      title: 'Date Range',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Last 30 days', id: '30' },
        { label: 'Last 90 days (recommended)', id: '90' },
        { label: 'Last 6 months', id: '180' },
      ],
      description:
        'On initial sync only. Controls how far back to look for calls with transcripts.',
    },
    {
      id: 'maxCalls',
      title: 'Max Calls',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      required: false,
      placeholder: 'Optional — limit to a single Gong workspace',
    },
    {
      id: 'primaryUserIds',
      title: 'Host User IDs',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Optional — comma-separated Gong user IDs (call hosts)',
      description:
        'Only sync calls hosted by these users. Find IDs in Gong under Company Settings → Users, or via the API.',
    },
  ],

  tagDefinitions: [
    { id: 'callTitle', displayName: 'Call Title', fieldType: 'text' },
    { id: 'participants', displayName: 'Participants', fieldType: 'text' },
    { id: 'duration', displayName: 'Duration (seconds)', fieldType: 'number' },
    { id: 'callDate', displayName: 'Call Date', fieldType: 'date' },
    { id: 'scheduledDate', displayName: 'Scheduled Date', fieldType: 'date' },
    { id: 'direction', displayName: 'Direction', fieldType: 'text' },
    { id: 'scope', displayName: 'Scope', fieldType: 'text' },
    { id: 'system', displayName: 'System', fieldType: 'text' },
    { id: 'language', displayName: 'Language', fieldType: 'text' },
    { id: 'purpose', displayName: 'Purpose', fieldType: 'text' },
    { id: 'isPrivate', displayName: 'Private', fieldType: 'boolean' },
  ],
}
