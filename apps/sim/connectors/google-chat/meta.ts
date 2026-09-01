import { GoogleChatIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

/**
 * Default per-space message window. Google Chat spaces are long-lived and a
 * single document holds one space's history, so the newest N messages are
 * indexed rather than the entire backlog.
 */
export const DEFAULT_MAX_MESSAGES = 1000

/**
 * Page size for `spaces.list`. The API defaults to 100 and accepts up to 1000;
 * 100 keeps each listing round-trip small, since a sync walks every page anyway.
 *
 * https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces/list
 */
export const SPACES_PAGE_SIZE = 100

/**
 * Page size for `spaces.messages.list`. The API defaults to 25 and accepts up to
 * 1000; the documented maximum is used so a space's message window is fetched in
 * as few round-trips as possible.
 *
 * https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/list
 */
export const MESSAGES_PAGE_SIZE = 1000

export const googleChatConnectorMeta: ConnectorMeta = {
  id: 'google_chat',
  name: 'Google Chat',
  description: 'Sync space conversations from Google Chat into your knowledge base',
  version: '1.0.0',
  icon: GoogleChatIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-chat',
    requiredScopes: [
      'https://www.googleapis.com/auth/chat.spaces.readonly',
      'https://www.googleapis.com/auth/chat.messages.readonly',
    ],
  },

  /**
   * A space document's `contentHash` is keyed on `lastActiveTime`, documented as
   * the timestamp of the last message in the space. Editing or deleting an
   * existing message does not move it, and the Chat API exposes no space-level
   * revision counter to key on instead, so a routine hash-gated sync cannot see
   * an edit-only or delete-only change until a newer message lands.
   *
   * Routine syncs therefore stay cheap, and an explicit full resync re-hydrates
   * every space (one messages listing per space) so edits and deletions are
   * picked up on demand. That cost is paid on every full resync, not once.
   */
  rehydrateOnFullSync: true,

  configFields: [
    {
      id: 'spaceTypes',
      title: 'Space Types',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Named spaces only (default)', id: 'SPACE' },
        { label: 'Named spaces and group chats', id: 'SPACE_AND_GROUP_CHAT' },
        { label: 'All conversations, including direct messages', id: 'ALL' },
      ],
      description:
        'Which conversations to sync. Direct messages are one-to-one conversations of the connected account — indexing them makes their contents searchable by everyone with access to this knowledge base.',
    },
    {
      id: 'maxMessages',
      title: 'Max Messages Per Space',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 500 (default: ${DEFAULT_MAX_MESSAGES})`,
      description:
        'Number of most recent messages indexed per space. Older messages are not included.',
    },
    {
      id: 'maxSpaces',
      title: 'Max Spaces',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 100 (default: unlimited)',
      description: 'Cap the total number of spaces synced. Leave blank to sync all of them.',
    },
    {
      id: 'lookbackDays',
      title: 'Lookback Window (days)',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 90 (default: all available)',
      description: 'Only index messages created in the last N days.',
    },
  ],

  tagDefinitions: [
    { id: 'spaceName', displayName: 'Space Name', fieldType: 'text' },
    { id: 'spaceType', displayName: 'Space Type', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Message Count', fieldType: 'number' },
    { id: 'lastActivity', displayName: 'Last Activity', fieldType: 'date' },
  ],
}
