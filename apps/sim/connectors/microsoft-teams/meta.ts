import { MicrosoftTeamsIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_MESSAGES = 1000

export const microsoftTeamsConnectorMeta: ConnectorMeta = {
  id: 'microsoft_teams',
  name: 'Microsoft Teams',
  description: 'Sync channel messages from Microsoft Teams',
  version: '1.0.0',
  icon: MicrosoftTeamsIcon,

  auth: {
    mode: 'oauth',
    provider: 'microsoft-teams',
    requiredScopes: ['ChannelMessage.Read.All', 'Channel.ReadBasic.All'],
  },

  configFields: [
    {
      id: 'teamSelector',
      title: 'Team',
      type: 'selector',
      selectorKey: 'microsoft.teams',
      canonicalParamId: 'teamId',
      mode: 'basic',
      placeholder: 'Select a team',
      required: true,
    },
    {
      id: 'teamId',
      title: 'Team ID',
      type: 'short-input',
      canonicalParamId: 'teamId',
      mode: 'advanced',
      placeholder: 'e.g. fbe2bf47-16c8-47cf-b4a5-4b9b187c508b',
      required: true,
      description: 'The ID of the Microsoft Teams team',
    },
    {
      id: 'channelSelector',
      title: 'Channels',
      type: 'selector',
      selectorKey: 'microsoft.channels',
      canonicalParamId: 'channel',
      mode: 'basic',
      multi: true,
      dependsOn: ['teamSelector'],
      placeholder: 'Select one or more channels',
      required: true,
    },
    {
      id: 'channel',
      title: 'Channels',
      type: 'short-input',
      canonicalParamId: 'channel',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. General, Announcements (comma-separated for multiple)',
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
