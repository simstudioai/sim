import { OtterIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const otterConnectorMeta: ConnectorMeta = {
  id: 'otter',
  name: 'Otter.ai',
  description: 'Sync meeting summaries, action items, and transcripts from Otter.ai',
  version: '1.0.0',
  icon: OtterIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Otter API key',
  },

  /**
   * Otter exposes no conversation modification timestamp. Recent conversations
   * are re-read daily by the connector; an explicit full resync rehydrates older
   * ones whose list metadata is unchanged (for example after a transcript edit).
   */
  rehydrateOnFullSync: true,

  configFields: [
    {
      id: 'scope',
      title: 'Conversations',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'My conversations', id: 'own' },
        { label: 'My conversations and ones shared with me', id: 'shared' },
      ],
      placeholder: 'My conversations',
      description: 'Defaults to your own conversations. Ignored when a channel ID is set.',
    },
    {
      id: 'channelId',
      title: 'Channel ID',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. an ID from the Otter.ai block List Channels operation',
      description: 'Only sync conversations in this Otter channel, including shared ones.',
    },
    {
      id: 'includeTranscript',
      title: 'Include Transcript',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No (summary, action items, insights, and outline only)', id: 'false' },
      ],
      placeholder: 'Yes',
      description:
        'Defaults to yes. Custom prompt output is only requested together with the transcript.',
    },
    {
      id: 'maxConversations',
      title: 'Max Conversations',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
      description: 'Cap the number of conversations synced, most recent first.',
    },
  ],

  tagDefinitions: [
    { id: 'owner', displayName: 'Owner', fieldType: 'text' },
    { id: 'guests', displayName: 'Calendar Guests', fieldType: 'text' },
    { id: 'channels', displayName: 'Channels', fieldType: 'text' },
    { id: 'conversationDate', displayName: 'Conversation Date', fieldType: 'date' },
  ],
}
