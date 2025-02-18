import { xIcon } from '@/components/icons'
import { XReadResponse, XSearchResponse, XUserResponse, XWriteResponse } from '@/tools/x/types'
import { BlockConfig } from '../types'

type XResponse = XWriteResponse | XReadResponse | XSearchResponse | XUserResponse

export const XBlock: BlockConfig<XResponse> = {
  type: 'x',
  name: 'X',
  description: 'Interact with X',
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
    // API Key (common)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your X Bearer token',
      password: true,
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
      options: ['true', 'false'],
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
      options: ['recency', 'relevancy'],
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
    {
      id: 'includeRecentTweets',
      title: 'Include Recent Tweets',
      type: 'dropdown',
      layout: 'full',
      options: ['true', 'false'],
      value: () => 'false',
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
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
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
    response: {
      type: {
        tweet: 'json',
        replies: 'any',
        context: 'any',
        tweets: 'json',
        includes: 'any',
        meta: 'json',
        user: 'json',
        recentTweets: 'any',
      },
    },
  },
}
