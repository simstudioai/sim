import { SentryIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

/**
 * Default issue search query.
 *
 * Reconciliation semantics: the sync engine hard-deletes any previously-synced
 * document whose `externalId` is absent from a full (non-capped) listing pass.
 * With the default `is:unresolved` query this means an issue that is resolved,
 * ignored/muted, or aged out of the query window will fall out of the listing
 * and be removed from the knowledge base on the next full sync. That is the
 * intended semantic — the KB tracks the *currently matching* issue set, not a
 * permanent archive. Users who want resolved issues retained should widen the
 * query (e.g. drop `is:unresolved`). When `maxIssues` caps the listing, the
 * engine sets `listingCapped` and skips deletion, so capped runs never remove
 * unseen issues.
 */
export const DEFAULT_QUERY = 'is:unresolved'

export const sentryConnectorMeta: ConnectorMeta = {
  id: 'sentry',
  name: 'Sentry',
  description: 'Sync issues and errors from Sentry into your knowledge base',
  version: '1.0.0',
  icon: SentryIcon,

  auth: {
    mode: 'apiKey',
    label: 'Auth Token',
    placeholder: 'Enter your Sentry auth token',
  },

  configFields: [
    {
      id: 'baseUrl',
      title: 'Sentry URL',
      type: 'short-input',
      placeholder: 'sentry.io',
      required: false,
      mode: 'advanced',
      description:
        'Host of your Sentry install. Leave blank for sentry.io. Set this for self-hosted Sentry (e.g. sentry.mycompany.com).',
    },
    {
      id: 'organization',
      title: 'Organization Slug',
      type: 'short-input',
      placeholder: 'e.g. my-org',
      required: true,
      description: 'The slug of your Sentry organization.',
    },
    {
      id: 'project',
      title: 'Project Slug',
      type: 'short-input',
      placeholder: 'e.g. my-project',
      required: true,
      description: 'The slug of the project whose issues should be synced.',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: `e.g. ${DEFAULT_QUERY}`,
      required: false,
      description:
        'Sentry search query to filter issues (e.g. "is:unresolved level:error environment:production"). Defaults to "is:unresolved".',
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. production',
      description: 'Only sync issues seen in this environment. Leave blank for all environments.',
    },
    {
      id: 'statsPeriod',
      title: 'Stats Period',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Sentry default (24h)', id: '' },
        { label: 'Last 24 hours', id: '24h' },
        { label: 'Last 14 days', id: '14d' },
      ],
      description: 'Time window for the issue stats Sentry computes on the project issues list.',
    },
    {
      id: 'maxIssues',
      title: 'Max Issues',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
      description: 'Cap the number of issues synced. Leave empty to sync all matching issues.',
    },
  ],

  tagDefinitions: [
    { id: 'level', displayName: 'Level', fieldType: 'text' },
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'count', displayName: 'Event Count', fieldType: 'number' },
    { id: 'firstSeen', displayName: 'First Seen', fieldType: 'date' },
    { id: 'lastSeen', displayName: 'Last Seen', fieldType: 'date' },
  ],
}
