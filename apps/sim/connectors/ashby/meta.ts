import { AshbyIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const ashbyConnectorMeta: ConnectorMeta = {
  id: 'ashby',
  name: 'Ashby',
  description: 'Sync candidate notes and interview feedback from Ashby',
  version: '1.0.0',
  icon: AshbyIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Ashby API key',
  },

  configFields: [
    {
      id: 'maxCandidates',
      title: 'Max Candidates',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
      description:
        'Cap the number of candidates synced. Leave empty to sync ALL candidates in the organization.',
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2025-01-01 or 2025-01-01T00:00:00Z',
      description:
        'Only sync candidates created on or after this date (ISO 8601). Leave blank to sync candidates regardless of creation date.',
    },
  ],

  tagDefinitions: [
    { id: 'candidateName', displayName: 'Candidate Name', fieldType: 'text' },
    { id: 'company', displayName: 'Current Company', fieldType: 'text' },
    { id: 'school', displayName: 'School', fieldType: 'text' },
    { id: 'location', displayName: 'Location', fieldType: 'text' },
    { id: 'source', displayName: 'Source', fieldType: 'text' },
    { id: 'emailDomain', displayName: 'Email Domain', fieldType: 'text' },
    { id: 'createdAt', displayName: 'Created', fieldType: 'date' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
  ],
}
