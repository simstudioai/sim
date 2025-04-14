import { RedditIcon } from '@/components/icons'
import { RedditHotPostsResponse } from '@/tools/reddit/types'
import { BlockConfig } from '../types'

export const RedditBlock: BlockConfig<RedditHotPostsResponse> = {
  type: 'reddit',
  name: 'Reddit',
  description: 'Fetch popular posts from Reddit',
  longDescription:
    'Access Reddit data to retrieve the most popular (hot) posts from any subreddit. Get post titles, content, authors, scores, and more.',
  category: 'tools',
  bgColor: '#FF5700',
  icon: RedditIcon,
  subBlocks: [
    // Subreddit input
    {
      id: 'subreddit',
      title: 'Subreddit',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter subreddit name (without r/)',
    },
    // Limit input
    {
      id: 'limit',
      title: 'Number of Top Posts',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
    },
  ],
  tools: {
    access: ['reddit_hot_posts'],
    config: {
      tool: () => 'reddit_hot_posts',
    },
  },
  inputs: {
    subreddit: {
      type: 'string',
      required: true,
      description: 'The name of the subreddit to fetch posts from (without the r/ prefix)',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum number of posts to return (default: 10, max: 100)',
    },
  },
  outputs: {
    response: {
      type: {
        subreddit: 'string',
        posts: 'json',
      },
    },
  },
}
