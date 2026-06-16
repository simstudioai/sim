import { GreenhouseIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const greenhouseConnectorMeta: ConnectorMeta = {
  id: 'greenhouse',
  name: 'Greenhouse',
  description: 'Sync candidate activity and interview scorecards from Greenhouse',
  version: '1.0.0',
  icon: GreenhouseIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Greenhouse Harvest API key',
  },

  supportsIncrementalSync: true,

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
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 123456',
      description:
        'Sync only candidates who applied to this Greenhouse job. Leave empty to sync candidates across all jobs.',
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2024-01-01T00:00:00Z',
      description:
        'Sync only candidates created at or after this ISO 8601 timestamp. Leave empty to sync candidates regardless of creation date.',
    },
    {
      id: 'createdBefore',
      title: 'Created Before',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2024-12-31T23:59:59Z',
      description:
        'Sync only candidates created before this ISO 8601 timestamp. Combine with Created After to backfill a bounded date range.',
    },
  ],

  tagDefinitions: [
    { id: 'candidateName', displayName: 'Candidate Name', fieldType: 'text' },
    { id: 'company', displayName: 'Company', fieldType: 'text' },
    { id: 'title', displayName: 'Title', fieldType: 'text' },
    { id: 'recruiter', displayName: 'Recruiter', fieldType: 'text' },
    { id: 'coordinator', displayName: 'Coordinator', fieldType: 'text' },
    { id: 'source', displayName: 'Source', fieldType: 'text' },
    { id: 'applicationCount', displayName: 'Application Count', fieldType: 'number' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
    { id: 'lastActivity', displayName: 'Last Activity', fieldType: 'date' },
  ],
}
