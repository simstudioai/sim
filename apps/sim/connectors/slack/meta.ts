import { SlackIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_MESSAGES = 1000

export const slackConnectorMeta: ConnectorMeta = {
  search: true,
  searchDocsUrl: 'https://docs.sim.ai/search/slack',
  id: 'slack',
  name: 'Slack',
  description:
    'Search Slack channel messages and complete threads, with links to the original messages. DMs are not included.',
  version: '2.0.0',
  icon: SlackIcon,

  auth: {
    mode: 'oauth',
    provider: 'slack',
    requiredScopes: [
      'channels:read',
      'channels:history',
      'groups:read',
      'groups:history',
      'users:read',
    ],
  },

  /**
   * `conversations.list` under a person's own token returns the public
   * channels of their workspace and the private channels they belong to,
   * exactly what they may read. Channel inclusion, exclusions, archives and
   * the earliest root-message date define the source's intended scope. A
   * complete member listing is authoritative within that scope. A numeric
   * message cap can truncate it and is disabled for per-member crawls.
   */
  permissionScopedListing: { capFieldIds: ['maxMessages'] },
  /** Team/channel/root identities and channel-visible text make member observations valid for service-ingested threads. */
  supportsSeparateContentCredential: true,

  configFields: [
    {
      id: 'channelSelector',
      title: 'Channels',
      type: 'selector',
      selectorKey: 'slack.channels',
      canonicalParamId: 'channel',
      mode: 'basic',
      multi: true,
      placeholder: 'All accessible channels',
      required: false,
      description:
        'Only index these channels. Leave blank for all accessible public and private channels.',
    },
    {
      id: 'channel',
      title: 'Channels',
      type: 'short-input',
      canonicalParamId: 'channel',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. general, C01ABC23DEF (comma-separated for multiple)',
      required: false,
      description:
        'Only index these channel names or IDs. Leave blank for all accessible public and private channels.',
    },
    {
      id: 'excludeChannels',
      setupGroup: 'options',
      title: 'Excluded Channels',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. hr, legal, C01ABC23DEF',
      description:
        'Comma-separated channel names or IDs to keep out of the index. Exclusions take precedence.',
    },
    {
      id: 'includeArchived',
      setupGroup: 'options',
      title: 'Archived Channels',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Include (default)', id: 'true' },
        { label: 'Exclude', id: 'false' },
      ],
    },
    {
      id: 'startDate',
      title: 'Earliest Message Date',
      type: 'short-input',
      required: false,
      placeholder: 'YYYY-MM-DD (optional)',
      description:
        'Index threads whose root message was posted on or after this UTC date, including their replies. Blank includes all available history, subject to Max Messages and Slack retention.',
    },
    {
      id: 'maxMessages',
      setupGroup: 'options',
      title: 'Max Messages',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 500 (default: ${DEFAULT_MAX_MESSAGES})`,
      description:
        'Maximum history messages scanned per channel. Use 0 for all available history in the date scope. Per-member search disables this cap so removals can be reconciled.',
    },
  ],

  tagDefinitions: [
    { id: 'channelName', displayName: 'Channel Name', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Message Count', fieldType: 'number' },
    { id: 'lastActivity', displayName: 'Last Activity', fieldType: 'date' },
  ],
}
