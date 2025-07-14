import { RedditIcon } from '@/components/icons'
import type {
  RedditCommentsResponse,
  RedditHotPostsResponse,
  RedditPostsResponse,
} from '@/tools/reddit/types'
import type { BlockConfig } from '../types'

export const RedditBlock: BlockConfig<
  RedditHotPostsResponse | RedditPostsResponse | RedditCommentsResponse
> = {
  type: 'reddit',
  name: 'Reddit',
  description: 'Access Reddit data and content',
  longDescription:
    'Access Reddit data to retrieve posts and comments from any subreddit. Get post titles, content, authors, scores, comments and more.',
  docsLink: 'https://docs.simstudio.ai/tools/reddit',
  category: 'tools',
  bgColor: '#FF5700',
  icon: RedditIcon,
  subBlocks: [
    // Operation selection
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Get Posts', id: 'get_posts' },
        { label: 'Get Comments', id: 'get_comments' },
      ],
    },

    // Reddit OAuth Authentication
    {
      id: 'credential',
      title: 'Reddit Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'reddit',
      serviceId: 'reddit',
      requiredScopes: ['identity', 'read'],
      placeholder: 'Select Reddit account',
    },

    // Common fields - appear for all actions
    {
      id: 'subreddit',
      title: 'Subreddit',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter subreddit name (without r/)',
      condition: {
        field: 'operation',
        value: ['get_posts', 'get_comments'],
      },
    },

    // Get Posts specific fields
    {
      id: 'sort',
      title: 'Sort By',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Hot', id: 'hot' },
        { label: 'New', id: 'new' },
        { label: 'Top', id: 'top' },
        { label: 'Rising', id: 'rising' },
      ],
      condition: {
        field: 'operation',
        value: 'get_posts',
      },
    },
    {
      id: 'time',
      title: 'Time Filter (for Top sort)',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Day', id: 'day' },
        { label: 'Week', id: 'week' },
        { label: 'Month', id: 'month' },
        { label: 'Year', id: 'year' },
        { label: 'All Time', id: 'all' },
      ],
      condition: {
        field: 'operation',
        value: 'get_posts',
        and: {
          field: 'sort',
          value: 'top',
        },
      },
    },
    {
      id: 'limit',
      title: 'Max Posts',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
      condition: {
        field: 'operation',
        value: 'get_posts',
      },
    },

    // Get Comments specific fields
    {
      id: 'postId',
      title: 'Post ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter post ID',
      condition: {
        field: 'operation',
        value: 'get_comments',
      },
    },
    {
      id: 'commentSort',
      title: 'Sort Comments By',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Confidence', id: 'confidence' },
        { label: 'Top', id: 'top' },
        { label: 'New', id: 'new' },
        { label: 'Controversial', id: 'controversial' },
        { label: 'Old', id: 'old' },
        { label: 'Random', id: 'random' },
        { label: 'Q&A', id: 'qa' },
      ],
      condition: {
        field: 'operation',
        value: 'get_comments',
      },
    },
    {
      id: 'commentLimit',
      title: 'Number of Comments',
      type: 'short-input',
      layout: 'full',
      placeholder: '50',
      condition: {
        field: 'operation',
        value: 'get_comments',
      },
    },
  ],
  tools: {
    access: ['reddit_get_posts', 'reddit_get_comments'],
    config: {
      tool: (inputs) => {
        const operation = inputs.operation || 'get_posts'

        if (operation === 'get_comments') {
          return 'reddit_get_comments'
        }

        return 'reddit_get_posts'
      },
      params: (inputs) => {
        const operation = inputs.operation || 'get_posts'
        const { credential, ...rest } = inputs

        if (operation === 'get_comments') {
          return {
            postId: rest.postId,
            subreddit: rest.subreddit,
            sort: rest.commentSort,
            limit: rest.commentLimit ? Number.parseInt(rest.commentLimit) : undefined,
            credential: credential,
          }
        }

        return {
          subreddit: rest.subreddit,
          sort: rest.sort,
          limit: rest.limit ? Number.parseInt(rest.limit) : undefined,
          time: rest.sort === 'top' ? rest.time : undefined,
          credential: credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    subreddit: { type: 'string', required: true },
    sort: { type: 'string', required: true },
    time: { type: 'string', required: false },
    limit: { type: 'number', required: false },
    postId: { type: 'string', required: true },
    commentSort: { type: 'string', required: false },
    commentLimit: { type: 'number', required: false },
  },
  outputs: {
    subreddit: 'string',
    posts: 'json',
    post: 'json',
    comments: 'json',
  },
}
