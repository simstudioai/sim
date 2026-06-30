import { xIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_POSTS = 200

export const xConnectorMeta: ConnectorMeta = {
  id: 'x',
  name: 'X',
  description: 'Sync posts from X (formerly Twitter) into your knowledge base',
  version: '1.0.0',
  icon: xIcon,

  auth: {
    mode: 'oauth',
    provider: 'x',
    requiredScopes: ['tweet.read', 'users.read', 'bookmark.read', 'like.read', 'offline.access'],
  },

  configFields: [
    {
      id: 'syncMode',
      title: 'Sync Mode',
      type: 'dropdown',
      required: false,
      description: 'Which posts to sync into the knowledge base',
      options: [
        { label: 'My posts', id: 'me' },
        { label: 'Another user', id: 'user' },
        { label: 'My mentions', id: 'mentions' },
        { label: 'My bookmarks', id: 'bookmarks' },
        { label: 'My likes', id: 'likes' },
      ],
    },
    {
      id: 'username',
      title: 'Username(s)',
      type: 'short-input',
      required: false,
      multi: true,
      placeholder: 'e.g. jack, xdevelopers (required for "Another user")',
      description:
        'One or more X usernames to sync posts from (comma-separated). Only used when Sync Mode is "Another user".',
    },
    {
      id: 'includeReplies',
      title: 'Include Replies',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Exclude replies', id: 'false' },
        { label: 'Include replies', id: 'true' },
      ],
      description: 'Whether to include reply posts. Applies to "My posts" and "Another user".',
    },
    {
      id: 'includeRetweets',
      title: 'Include Retweets',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Exclude retweets', id: 'false' },
        { label: 'Include retweets', id: 'true' },
      ],
      description: 'Whether to include retweets. Applies to "My posts" and "Another user".',
    },
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2024-01-01T00:00:00Z',
      description:
        'Oldest post time (ISO 8601 UTC). Applies to posts and mentions; ignored for bookmarks and likes.',
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2024-12-31T23:59:59Z',
      description:
        'Newest post time (ISO 8601 UTC). Applies to posts and mentions; ignored for bookmarks and likes.',
    },
    {
      id: 'maxPosts',
      title: 'Max Posts',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 100 (default: ${DEFAULT_MAX_POSTS})`,
      description:
        'Maximum number of posts to sync (across all configured users). Posts beyond this limit are not deleted from the knowledge base; X also only exposes a limited recent window (≈3,200 timeline posts, ≈800 bookmarks), so posts that age out of that window are removed on the next sync.',
    },
  ],

  tagDefinitions: [
    { id: 'author', displayName: 'Author', fieldType: 'text' },
    { id: 'createdAt', displayName: 'Created Date', fieldType: 'date' },
    { id: 'likeCount', displayName: 'Like Count', fieldType: 'number' },
    { id: 'retweetCount', displayName: 'Retweet Count', fieldType: 'number' },
  ],
}
