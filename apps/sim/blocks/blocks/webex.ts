import { WebexIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { WebexResponse } from '@/tools/webex/types'

export const WebexBlock: BlockConfig<WebexResponse> = {
  type: 'webex',
  name: 'Webex',
  description: 'Interact with Webex',
  longDescription:
    'Integrate Webex into the workflow. Can fetch rooms and messages, create and edit messages. Requires OAuth.',
  docsLink: 'https://docs.sim.ai/tools/webex',
  category: 'tools',
  bgColor: '#E0E0E0', // Webex's white color
  icon: WebexIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'List Rooms', id: 'list_rooms' },
        { label: 'List Messages', id: 'list_messages' },
        { label: 'Create Message', id: 'create_message' },
        { label: 'Edit Message', id: 'edit_message' },
      ],
      value: () => 'list_rooms',
    },
    {
      id: 'credential',
      title: 'Webex Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'webex',
      serviceId: 'webex',
      requiredScopes: [
        'spark:people_read',
        'spark:messages_read',
        'spark:messages_write',
        'spark-compliance:rooms_read',
        'spark:rooms_read',
      ],
      placeholder: 'Select Webex account',
      required: true,
    },
    {
      id: 'teamId',
      title: 'Team ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Team ID',
      condition: {
        field: 'operation',
        value: ['list_rooms'],
      },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'type',
      title: 'Type',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Type',
      condition: {
        field: 'operation',
        value: ['list_rooms'],
      },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'from',
      title: 'From',
      type: 'short-input',
      layout: 'full',
      placeholder: '2022-10-10T17:00:00.000Z',
      condition: {
        field: 'operation',
        value: ['list_rooms'],
      },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      layout: 'full',
      placeholder: '2022-10-10T17:00:00.000Z',
      condition: {
        field: 'operation',
        value: ['list_rooms'],
      },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'max',
      title: 'Max',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Max',
      condition: {
        field: 'operation',
        value: ['list_rooms', 'list_messages'],
      },
      required: false,
    },
    //
    // Operation: For list messages
    {
      id: 'roomId',
      title: 'Room ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Room ID',
      condition: {
        field: 'operation',
        // list_messages and edit_message do required it.
        value: ['list_messages', 'create_message', 'edit_message'],
      },
      required: true,
    },
    // mentionedGroups array of string
    {
      id: 'mentionedGroups',
      title: 'Mentioned Groups',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Group names, comma-separated',
      condition: { field: 'operation', value: ['list_messages'] },
      mode: 'advanced',
      required: false,
    },
    // mentionedPeople array of string
    {
      id: 'mentionedPeople',
      title: 'Mentioned People',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Only me or the person ID of the current user may be specified, comma-separated',
      condition: { field: 'operation', value: ['list_messages'] },
      mode: 'advanced',
      required: false,
    },
    // before string
    {
      id: 'before',
      title: 'Before',
      type: 'short-input',
      layout: 'full',
      placeholder: '2016-04-21T19:01:55.966Z',
      condition: {
        field: 'operation',
        value: ['list_messages'],
      },
      required: false,
    },
    // beforeMessage string
    {
      id: 'beforeMessage',
      title: 'Before Message',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Message ID',
      condition: {
        field: 'operation',
        value: ['list_messages'],
      },
      required: false,
    },
    //
    // Operation: for create messages
    // markdown string
    {
      id: 'markdown',
      title: 'Markdown',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Markdown message',
      condition: { field: 'operation', value: ['create_message', 'edit_message'] },
      required: false,
    },
    // parentId string
    {
      id: 'parentId',
      title: 'Parent ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Parent message ID to reply to',
      condition: { field: 'operation', value: ['create_message'] },
      mode: 'advanced',
      required: false,
    },
    // text string
    {
      id: 'text',
      title: 'Text',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Text message',
      condition: { field: 'operation', value: ['create_message', 'edit_message'] },
      required: false,
    },
    // toPersonEmail string
    {
      id: 'toPersonEmail',
      title: 'To Person Email',
      type: 'short-input',
      layout: 'full',
      placeholder: 'The recipient email address',
      condition: { field: 'operation', value: ['create_message'] },
      mode: 'advanced',
      required: false,
    },
    // toPersonId string
    {
      id: 'toPersonId',
      title: 'To Person ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'The recipient person ID',
      condition: { field: 'operation', value: ['create_message'] },
      mode: 'advanced',
      required: false,
    },
    // files string[]
    {
      id: 'files',
      title: 'Files',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Public URL to a binary file',
      condition: { field: 'operation', value: ['create_message'] },
      mode: 'advanced',
      required: false,
    },
    // attachments Attachment[]
    //
    // Operation: for edit message
    // messageId* string
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Message ID',
      condition: { field: 'operation', value: 'edit_message' },
      required: true,
    },
  ],
  tools: {
    access: [
      'webex_list_rooms',
      'webex_list_messages',
      'webex_create_message',
      'webex_edit_message',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'list_rooms':
            return 'webex_list_rooms'
          case 'list_messages':
            return 'webex_list_messages'
          case 'create_message':
            return 'webex_create_message'
          case 'edit_message':
            return 'webex_edit_message'
          default:
            throw new Error(`Invalid Webex operation: ${params.operation}`)
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
          // Convert numeric strings to numbers where appropriate
          if (key === 'max' && value) {
            parsedParams[key] = Number.parseInt(value as string, 10)
          }
          // Handle mediaIds conversion from comma-separated string to array
          else if (
            (key === 'files' || key === 'mentionedPeople' || key === 'mentionedGroups') &&
            typeof value === 'string'
          ) {
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
    credential: { type: 'string', description: 'Webex access token' },
    //
    teamId: { type: 'string', description: 'Team ID' },
    type: { type: 'string', description: 'Room type, "direct" or "group"' },
    from: { type: 'string', description: 'Made public after this timestamp' },
    to: { type: 'string', description: 'Made public before this timestamp' },
    max: { type: 'number', description: 'Maximum number of items to retrieve' },
    //
    roomId: { type: 'string', description: 'Room ID' },
    mentionedGroups: {
      type: 'string',
      description: 'Group names for the groups mentioned in the message.',
    },
    mentionedPeople: {
      type: 'string',
      description: 'People IDs for anyone mentioned in the message',
    },
    before: { type: 'string', description: 'List messages sent before a date and time' },
    beforeMessage: { type: 'string', description: 'List messages sent before a message, by ID' },
    //
    markdown: { type: 'string', description: 'Markdown message' },
    parentId: { type: 'string', description: 'Parent ID message' },
    text: { type: 'string', description: 'Text message' },
    toPersonEmail: { type: 'string', description: 'The recipient email address' },
    toPersonId: { type: 'string', description: 'The recipient person ID' },
    files: {
      type: 'string',
      description:
        'Public URLs to binary files (comma-separated), currently only one file may be included',
    },
    //
    messageId: { type: 'string', description: 'Message ID' },
  },
  outputs: {
    // Common outputs
    message: { type: 'string', description: 'Response message' },
    results: { type: 'json', description: 'Operation results' },
    //
    createdId: { type: 'string', description: 'Created ID' },
  },
}
