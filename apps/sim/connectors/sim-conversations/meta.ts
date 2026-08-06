import { MessagesIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const simConversationsConnectorMeta: ConnectorMeta = {
  id: 'sim_conversations',
  name: 'Agent Conversations',
  description: 'Sync agent block conversation memory so you can search and analyze what users ask',
  version: '1.0.0',
  icon: MessagesIcon,

  auth: { mode: 'sim' },

  configFields: [
    {
      id: 'conversationIdPrefix',
      title: 'Conversation ID Prefix',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. support-',
      description:
        'Only conversations whose ID starts with this text are synced. Scoping is by ID rather than by workflow because one conversation ID can be shared across several agent blocks and workflows. Leave empty to sync every conversation in this workspace.',
    },
    {
      id: 'minMessages',
      title: 'Minimum Messages',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 2',
      description: 'Skips conversations shorter than this. Defaults to 1.',
    },
    {
      id: 'maxConversations',
      title: 'Max Conversations',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 1000',
      description: 'Caps how many conversations are indexed. Leave empty for no limit.',
    },
  ],

  /**
   * Deliberately absent, for the same reasons as `sim_files`: listing is one indexed
   * local query, and an incremental run would disable deletion reconciliation
   * (`shouldReconcileDeletions`), so conversations deleted at the source would linger
   * in the knowledge base until someone ran a manual full resync.
   */
  supportsIncrementalSync: false,

  /**
   * `startedAt` is deliberately omitted. `DocumentTags` exposes only two date slots,
   * so claiming both would leave none for any other connector on the same knowledge
   * base — and `allocateTagSlots` would silently skip whichever it could not place.
   */
  tagDefinitions: [
    { id: 'conversationId', displayName: 'Conversation ID', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Message Count', fieldType: 'number' },
    { id: 'lastActivity', displayName: 'Last Activity', fieldType: 'date' },
  ],
}
