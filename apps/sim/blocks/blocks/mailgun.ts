import { MailgunIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { SendMessageResult } from '@/tools/mailgun/types'

export const MailgunBlock: BlockConfig<SendMessageResult> = {
  type: 'mailgun',
  name: 'Mailgun',
  description: 'Send emails and manage mailing lists with Mailgun',
  longDescription:
    'Integrate Mailgun into your workflow. Send transactional emails, manage mailing lists and members, view domain information, and track email events. Supports text and HTML emails, tags for tracking, and comprehensive list management.',
  docsLink: 'https://docs.sim.ai/tools/mailgun',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MailgunIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Message Operations
        { label: 'Send Message', id: 'send_message' },
        { label: 'Get Message', id: 'get_message' },
        { label: 'List Messages', id: 'list_messages' },
        // Mailing List Operations
        { label: 'Create Mailing List', id: 'create_mailing_list' },
        { label: 'Get Mailing List', id: 'get_mailing_list' },
        { label: 'Add List Member', id: 'add_list_member' },
        // Domain Operations
        { label: 'List Domains', id: 'list_domains' },
        { label: 'Get Domain', id: 'get_domain' },
      ],
      value: () => 'send_message',
    },
    {
      id: 'apiKey',
      title: 'Mailgun API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Mailgun API key',
      required: true,
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'mg.example.com',
      condition: {
        field: 'operation',
        value: ['send_message', 'get_message', 'list_messages', 'get_domain'],
      },
      required: true,
    },
    // Send Message fields
    {
      id: 'from',
      title: 'From Email',
      type: 'short-input',
      placeholder: 'sender@example.com',
      condition: { field: 'operation', value: 'send_message' },
      required: true,
    },
    {
      id: 'to',
      title: 'To Email',
      type: 'short-input',
      placeholder: 'recipient@example.com',
      condition: { field: 'operation', value: 'send_message' },
      required: true,
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: 'send_message' },
      required: true,
    },
    {
      id: 'text',
      title: 'Text Body',
      type: 'long-input',
      placeholder: 'Plain text email body',
      condition: { field: 'operation', value: 'send_message' },
    },
    {
      id: 'html',
      title: 'HTML Body',
      type: 'code',
      placeholder: '<html><body>HTML email body</body></html>',
      condition: { field: 'operation', value: 'send_message' },
    },
    {
      id: 'cc',
      title: 'CC',
      type: 'short-input',
      placeholder: 'cc@example.com',
      condition: { field: 'operation', value: 'send_message' },
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
      placeholder: 'bcc@example.com',
      condition: { field: 'operation', value: 'send_message' },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'tag1, tag2',
      condition: { field: 'operation', value: 'send_message' },
    },
    // Get Message fields
    {
      id: 'messageKey',
      title: 'Message Key',
      type: 'short-input',
      placeholder: 'Message storage key',
      condition: { field: 'operation', value: 'get_message' },
      required: true,
    },
    // List Messages fields
    {
      id: 'event',
      title: 'Event Type',
      type: 'dropdown',
      options: [
        { label: 'All Events', id: '' },
        { label: 'Accepted', id: 'accepted' },
        { label: 'Delivered', id: 'delivered' },
        { label: 'Failed', id: 'failed' },
        { label: 'Opened', id: 'opened' },
        { label: 'Clicked', id: 'clicked' },
        { label: 'Unsubscribed', id: 'unsubscribed' },
        { label: 'Complained', id: 'complained' },
        { label: 'Stored', id: 'stored' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_messages' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'list_messages' },
    },
    // Create Mailing List fields
    {
      id: 'address',
      title: 'List Address',
      type: 'short-input',
      placeholder: 'list@example.com',
      condition: {
        field: 'operation',
        value: ['create_mailing_list', 'get_mailing_list', 'add_list_member'],
      },
      required: true,
    },
    {
      id: 'name',
      title: 'List Name',
      type: 'short-input',
      placeholder: 'My Mailing List',
      condition: { field: 'operation', value: 'create_mailing_list' },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Description of the mailing list',
      condition: { field: 'operation', value: 'create_mailing_list' },
    },
    {
      id: 'accessLevel',
      title: 'Access Level',
      type: 'dropdown',
      options: [
        { label: 'Read Only', id: 'readonly' },
        { label: 'Members', id: 'members' },
        { label: 'Everyone', id: 'everyone' },
      ],
      value: () => 'readonly',
      condition: { field: 'operation', value: 'create_mailing_list' },
    },
    // Add List Member fields (reuse address from above for listAddress)
    {
      id: 'memberAddress',
      title: 'Member Email',
      type: 'short-input',
      placeholder: 'member@example.com',
      condition: { field: 'operation', value: 'add_list_member' },
      required: true,
    },
    {
      id: 'memberName',
      title: 'Member Name',
      type: 'short-input',
      placeholder: 'John Doe',
      condition: { field: 'operation', value: 'add_list_member' },
    },
    {
      id: 'vars',
      title: 'Custom Variables',
      type: 'code',
      placeholder: '{"key": "value"}',
      condition: { field: 'operation', value: 'add_list_member' },
    },
    {
      id: 'subscribed',
      title: 'Subscribed',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'add_list_member' },
    },
  ],

  tools: {
    access: [
      'mailgun_send_message',
      'mailgun_get_message',
      'mailgun_list_messages',
      'mailgun_create_mailing_list',
      'mailgun_get_mailing_list',
      'mailgun_add_list_member',
      'mailgun_list_domains',
      'mailgun_get_domain',
    ],
    config: {
      tool: (params) => `mailgun_${params.operation}`,
      params: (params) => {
        const { operation, memberAddress, memberName, ...rest } = params

        // Handle special field mappings for add_list_member
        if (operation === 'add_list_member') {
          return {
            ...rest,
            listAddress: params.address,
            address: memberAddress,
            name: memberName,
            subscribed: params.subscribed === 'true',
          }
        }

        return rest
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Mailgun API key' },
    domain: { type: 'string', description: 'Mailgun domain' },
    // Message inputs
    from: { type: 'string', description: 'Sender email address' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    text: { type: 'string', description: 'Plain text body' },
    html: { type: 'string', description: 'HTML body' },
    cc: { type: 'string', description: 'CC email address' },
    bcc: { type: 'string', description: 'BCC email address' },
    tags: { type: 'string', description: 'Tags for the email' },
    messageKey: { type: 'string', description: 'Message storage key' },
    event: { type: 'string', description: 'Event type filter' },
    limit: { type: 'number', description: 'Number of events to return' },
    // Mailing list inputs
    address: { type: 'string', description: 'Mailing list address' },
    name: { type: 'string', description: 'List or member name' },
    description: { type: 'string', description: 'List description' },
    accessLevel: { type: 'string', description: 'List access level' },
    memberAddress: { type: 'string', description: 'Member email address' },
    memberName: { type: 'string', description: 'Member name' },
    vars: { type: 'string', description: 'Custom variables JSON' },
    subscribed: { type: 'string', description: 'Member subscription status' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    id: { type: 'string', description: 'Message ID' },
    message: { type: 'string', description: 'Response message' },
    items: { type: 'json', description: 'Array of items (messages, domains)' },
    list: { type: 'json', description: 'Mailing list details' },
    member: { type: 'json', description: 'Member details' },
    domain: { type: 'json', description: 'Domain details' },
    totalCount: { type: 'number', description: 'Total count of items' },
  },
}
