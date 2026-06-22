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
