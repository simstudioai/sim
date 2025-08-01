import { xIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { XResponse } from '@/tools/x/types'

export const XBlock: BlockConfig<XResponse> = {
  type: 'x',
  name: 'X',
  description: 'Interact with X',
  longDescription:
    'Connect with X to post tweets, read content, search for information, and access user profiles. Integrate social media capabilities into your workflow with comprehensive X platform access.',
  docsLink: 'https://docs.sim.ai/tools/x',
  category: 'tools',
  bgColor: '#000000', // X's black color
  icon: xIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Post a New Tweet', id: 'x_write' },
        { label: 'Get Tweet Details', id: 'x_read' },
        { label: 'Search Tweets', id: 'x_search' },
        { label: 'Get User Profile', id: 'x_user' },
      ],
      value: () => 'x_write',
    },
    {
      id: 'credential',
      title: 'X Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'x',
      serviceId: 'x',
      requiredScopes: ['tweet.read', 'tweet.write', 'users.read'],
      placeholder: 'Select X account',
    },
    {
      id: 'text',
      title: 'Tweet Text',
      type: 'long-input',
      layout: 'full',
      placeholder: "What's happening?",
      condition: { field: 'operation', value: 'x_write' },
      required: true,
    },
    {
      id: 'replyTo',
      title: 'Reply To (Tweet ID)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter tweet ID to reply to',
      condition: { field: 'operation', value: 'x_write' },
    },
    {
      id: 'mediaIds',
      title: 'Media IDs',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter comma-separated media IDs',
      condition: { field: 'operation', value: 'x_write' },
    },
    {
      id: 'tweetId',
      title: 'Tweet ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter tweet ID to read',
      condition: { field: 'operation', value: 'x_read' },
      required: true,
    },
    {
      id: 'includeReplies',
      title: 'Include Replies',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'true', id: 'true' },
        { label: 'false', id: 'false' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'x_read' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter search terms (supports X search operators)',
      condition: { field: 'operation', value: 'x_search' },
      required: true,
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
      condition: { field: 'operation', value: 'x_search' },
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'recency', id: 'recency' },
        { label: 'relevancy', id: 'relevancy' },
      ],
      value: () => 'recency',
      condition: { field: 'operation', value: 'x_search' },
    },
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      layout: 'full',
      placeholder: 'YYYY-MM-DDTHH:mm:ssZ',
      condition: { field: 'operation', value: 'x_search' },
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      layout: 'full',
      placeholder: 'YYYY-MM-DDTHH:mm:ssZ',
      condition: { field: 'operation', value: 'x_search' },
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter username (without @)',
      condition: { field: 'operation', value: 'x_user' },
      required: true,
    },
  ],
  tools: {
    access: ['x_write', 'x_read', 'x_search', 'x_user'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'x_write':
            return 'x_write'
          case 'x_read':
            return 'x_read'
          case 'x_search':
            return 'x_search'
          case 'x_user':
            return 'x_user'
          default:
            return 'x_write'
        }
      },
      params: (params) => {
        const { credential, ...rest } = params

        // Convert string values to appropriate types
        const parsedParams: Record<string, any> = {
          credential: credential,
        }

        // Add other params
        Object.keys(rest).forEach((key) => {
          const value = rest[key]

          // Convert string boolean values to actual booleans
          if (value === 'true' || value === 'false') {
            parsedParams[key] = value === 'true'
          }
          // Convert numeric strings to numbers where appropriate
          else if (key === 'maxResults' && value) {
            parsedParams[key] = Number.parseInt(value as string, 10)
          }
          // Handle mediaIds conversion from comma-separated string to array
          else if (key === 'mediaIds' && typeof value === 'string') {
            parsedParams[key] = value
              .split(',')
              .map((id) => id.trim())
              .filter((id) => id !== '')
          }
          // Keep other values as is
          else {
            parsedParams[key] = value
          }
        })

        return parsedParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'X account credential' },
    text: { type: 'string', description: 'Tweet text content' },
    replyTo: { type: 'string', description: 'Reply to tweet ID' },
    mediaIds: { type: 'string', description: 'Media identifiers' },
    poll: { type: 'json', description: 'Poll configuration' },
    tweetId: { type: 'string', description: 'Tweet identifier' },
    includeReplies: { type: 'boolean', description: 'Include replies' },
    query: { type: 'string', description: 'Search query terms' },
    maxResults: { type: 'number', description: 'Maximum search results' },
    startTime: { type: 'string', description: 'Search start time' },
    endTime: { type: 'string', description: 'Search end time' },
    sortOrder: { type: 'string', description: 'Result sort order' },
    username: { type: 'string', description: 'User profile name' },
    includeRecentTweets: { type: 'boolean', description: 'Include recent tweets' },
  },
  outputs: {
    tweet: { type: 'json', description: 'Tweet data' },
    replies: { type: 'any', description: 'Tweet replies' },
    context: { type: 'any', description: 'Tweet context' },
    tweets: { type: 'json', description: 'Tweets data' },
    includes: { type: 'any', description: 'Additional data' },
    meta: { type: 'json', description: 'Response metadata' },
    user: { type: 'json', description: 'User profile data' },
    recentTweets: { type: 'any', description: 'Recent tweets data' },
  },
}
