import { RedditIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_POSTS = 200

export const redditConnectorMeta: ConnectorMeta = {
  id: 'reddit',
  name: 'Reddit',
  description: 'Sync subreddit posts and comments from Reddit',
  version: '1.0.0',
  icon: RedditIcon,

  auth: {
    mode: 'oauth',
    provider: 'reddit',
    requiredScopes: ['read'],
  },

  configFields: [
    {
      id: 'subreddit',
      title: 'Subreddit',
      type: 'short-input',
      placeholder: 'e.g. machinelearning',
      required: true,
      description: 'Subreddit name to sync posts from (without r/ prefix)',
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'dropdown',
      required: false,
      description: 'How to sort posts',
      options: [
        { label: 'Hot', id: 'hot' },
        { label: 'New', id: 'new' },
        { label: 'Top', id: 'top' },
        { label: 'Rising', id: 'rising' },
      ],
    },
    {
      id: 'timeFilter',
      title: 'Time Filter',
      type: 'dropdown',
      required: false,
      description: 'Time range for top posts (only applies when sort is "Top")',
      options: [
        { label: 'Past Day', id: 'day' },
        { label: 'Past Week', id: 'week' },
        { label: 'Past Month', id: 'month' },
        { label: 'Past Year', id: 'year' },
        { label: 'All Time', id: 'all' },
      ],
    },
    {
      id: 'maxPosts',
      title: 'Max Posts',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 100 (default: ${DEFAULT_MAX_POSTS})`,
      description: 'Maximum number of posts to sync',
    },
  ],

  tagDefinitions: [
    { id: 'author', displayName: 'Author', fieldType: 'text' },
    { id: 'score', displayName: 'Score', fieldType: 'number' },
    { id: 'commentCount', displayName: 'Comment Count', fieldType: 'number' },
    { id: 'flair', displayName: 'Flair', fieldType: 'text' },
    { id: 'postDate', displayName: 'Post Date', fieldType: 'date' },
  ],
}
