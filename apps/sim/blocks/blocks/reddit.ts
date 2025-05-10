import { RedditIcon } from '@/components/icons'
import {
  RedditCommentsResponse,
  RedditHotPostsResponse,
  RedditPostsResponse,
} from '@/tools/reddit/types'
import { BlockConfig } from '../types'

export const RedditBlock: BlockConfig<
  RedditHotPostsResponse | RedditPostsResponse | RedditCommentsResponse
> = {
  type: 'reddit',
  name: 'Reddit',
  description: 'Access Reddit data and content',
  longDescription:
    'Access Reddit data to retrieve posts and comments from any subreddit. Get post titles, content, authors, scores, comments and more.',
  category: 'tools',
  bgColor: '#FF5700',
  icon: RedditIcon,
  subBlocks: [
    // Action selection
    {
      id: 'action',
      title: 'Action',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Get Posts', id: 'get_posts' },
        { label: 'Get Comments', id: 'get_comments' },
      ],
    },

    // Common fields - appear for all actions
    {
      id: 'subreddit',
      title: 'Subreddit',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter subreddit name (without r/)',
      condition: {
        field: 'action',
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
        field: 'action',
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
        field: 'action',
        value: 'get_posts',
        and: {
          field: 'sort',
          value: 'top',
        },
      },
    },
    {
      id: 'limit',
      title: 'Number of Posts',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
      condition: {
        field: 'action',
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
        field: 'action',
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
        field: 'action',
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
        field: 'action',
        value: 'get_comments',
      },
    },
  ],
  tools: {
    access: ['reddit_hot_posts', 'reddit_get_posts', 'reddit_get_comments'],
    config: {
      tool: (inputs) => {
        const action = inputs.action || 'get_posts'

        if (action === 'get_comments') {
          return 'reddit_get_comments'
        }

        return 'reddit_get_posts'
      },
      params: (inputs) => {
        const action = inputs.action || 'get_posts'

        if (action === 'get_comments') {
          return {
            postId: inputs.postId,
            subreddit: inputs.subreddit,
            sort: inputs.commentSort,
            limit: inputs.commentLimit ? parseInt(inputs.commentLimit) : undefined,
          }
        }

        return {
          subreddit: inputs.subreddit,
          sort: inputs.sort,
          limit: inputs.limit ? parseInt(inputs.limit) : undefined,
          time: inputs.sort === 'top' ? inputs.time : undefined,
        }
      },
    },
  },
  inputs: {
    action: {
      type: 'string',
      required: true,
      description: 'The action to perform: get_posts or get_comments',
    },
    subreddit: {
      type: 'string',
      required: true,
      description: 'The name of the subreddit to fetch data from (without the r/ prefix)',
    },
    sort: {
      type: 'string',
      required: true,
      description: 'Sort method for posts: "hot", "new", "top", or "rising" (default: "hot")',
    },
    time: {
      type: 'string',
      required: false,
      description:
        'Time filter for "top" sorted posts: "hour", "day", "week", "month", "year", or "all" (default: "day")',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum number of posts to return (default: 10, max: 100)',
    },
    postId: {
      type: 'string',
      required: true,
      description: 'The ID of the Reddit post to fetch comments from',
    },
    commentSort: {
      type: 'string',
      required: false,
      description:
        'Sort method for comments: "confidence", "top", "new", "controversial", "old", "random", "qa" (default: "confidence")',
    },
    commentLimit: {
      type: 'number',
      required: false,
      description: 'Maximum number of comments to return (default: 50, max: 100)',
    },
  },
  outputs: {
    response: {
      type: {
        subreddit: 'string',
        posts: 'json',
        post: 'json',
        comments: 'json',
      },
    },
  },
}
