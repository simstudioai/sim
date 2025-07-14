import { xIcon } from '@/components/icons'
import type { XReadResponse, XSearchResponse, XUserResponse, XWriteResponse } from '@/tools/x/types'
import type { BlockConfig } from '../types'

type XResponse = XWriteResponse | XReadResponse | XSearchResponse | XUserResponse

export const XBlock: BlockConfig<XResponse> = {
  type: 'x',
  name: 'X',
  description: 'Interact with X',
  longDescription:
    'Connect with X to post tweets, read content, search for information, and access user profiles. Integrate social media capabilities into your workflow with comprehensive X platform access.',
  docsLink: 'https://docs.simstudio.ai/tools/x',
  category: 'tools',
  bgColor: '#000000', // X's black color
  icon: xIcon,
  subBlocks: [
    // Operation selector
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
    // X OAuth Authentication
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
    // Write operation inputs
    {
      id: 'text',
      title: 'Tweet Text',
      type: 'long-input',
      layout: 'full',
      placeholder: "What's happening?",
      condition: { field: 'operation', value: 'x_write' },
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
    // Read operation inputs
    {
      id: 'tweetId',
      title: 'Tweet ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter tweet ID to read',
      condition: { field: 'operation', value: 'x_read' },
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
    // Search operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter search terms (supports X search operators)',
      condition: { field: 'operation', value: 'x_search' },
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
    // User operation inputs
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter username (without @)',
      condition: { field: 'operation', value: 'x_user' },
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
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    // Write operation
    text: { type: 'string', required: false },
    replyTo: { type: 'string', required: false },
    mediaIds: { type: 'string', required: false },
    poll: { type: 'json', required: false },
    // Read operation
    tweetId: { type: 'string', required: false },
    includeReplies: { type: 'boolean', required: false },
    // Search operation
    query: { type: 'string', required: false },
    maxResults: { type: 'number', required: false },
    startTime: { type: 'string', required: false },
    endTime: { type: 'string', required: false },
    sortOrder: { type: 'string', required: false },
    // User operation
    username: { type: 'string', required: false },
    includeRecentTweets: { type: 'boolean', required: false },
  },
  outputs: {
    tweet: 'json',
    replies: 'any',
    context: 'any',
    tweets: 'json',
    includes: 'any',
    meta: 'json',
    user: 'json',
    recentTweets: 'any',
  },
}
