import { SlackIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_MESSAGES = 1000

export const slackConnectorMeta: ConnectorMeta = {
  id: 'slack',
  name: 'Slack',
  description: 'Sync channel messages from Slack',
  version: '1.0.0',
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
   * exactly what they may read, so one member's crawl is their access. The
   * channel selection is a cap: it would hide part of a member's corpus, and
   * the per-member crawl indexes every channel the member can see instead.
   * `maxMessages` bounds each channel document's window, not which channels
   * are listed, so it is not a cap.
   */
  permissionScopedListing: { capFieldIds: ['channel'] },

  configFields: [
    {
      id: 'channelSelector',
      title: 'Channels',
      type: 'selector',
      selectorKey: 'slack.channels',
      canonicalParamId: 'channel',
      mode: 'basic',
      multi: true,
      placeholder: 'Select one or more channels',
      required: true,
      description: 'Channels to sync messages from',
    },
    {
      id: 'channel',
      title: 'Channels',
      type: 'short-input',
      canonicalParamId: 'channel',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. general, C01ABC23DEF (comma-separated for multiple)',
      required: true,
      description: 'Channel names or IDs to sync messages from',
    },
    {
      id: 'maxMessages',
      title: 'Max Messages',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 500 (default: ${DEFAULT_MAX_MESSAGES})`,
    },
  ],

  tagDefinitions: [
    { id: 'channelName', displayName: 'Channel Name', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Message Count', fieldType: 'number' },
    { id: 'lastActivity', displayName: 'Last Activity', fieldType: 'date' },
  ],
}
