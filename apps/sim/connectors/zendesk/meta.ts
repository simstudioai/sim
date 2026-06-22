import { ZendeskIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_TICKETS = 500

export const zendeskConnectorMeta: ConnectorMeta = {
  id: 'zendesk',
  name: 'Zendesk',
  description: 'Sync Help Center articles and support tickets from Zendesk',
  version: '1.0.0',
  icon: ZendeskIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Token',
    placeholder: 'Enter your Zendesk API token',
  },

  configFields: [
    {
      id: 'subdomain',
      title: 'Subdomain',
      type: 'short-input',
      placeholder: 'yourcompany (from yourcompany.zendesk.com)',
      required: true,
      description: 'Your Zendesk subdomain',
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'agent@yourcompany.com',
      required: true,
      description: 'Email address of the Zendesk user for API authentication',
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      required: true,
      description: 'What content to sync from Zendesk',
      options: [
        { label: 'Articles & Tickets', id: 'both' },
        { label: 'Help Center Articles Only', id: 'articles' },
        { label: 'Support Tickets Only', id: 'tickets' },
      ],
    },
    {
      id: 'ticketStatus',
      title: 'Ticket Status Filter',
      type: 'dropdown',
      required: false,
      description: 'Filter tickets by status (applies only when syncing tickets)',
      options: [
        { label: 'All Statuses', id: 'all' },
        { label: 'New', id: 'new' },
        { label: 'Open', id: 'open' },
        { label: 'Pending', id: 'pending' },
        { label: 'On Hold', id: 'hold' },
        { label: 'Solved', id: 'solved' },
        { label: 'Closed', id: 'closed' },
      ],
    },
    {
      id: 'locale',
      title: 'Article Locale',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. en-us (default: all locales)',
      description: 'Locale for Help Center articles',
    },
    {
      id: 'maxTickets',
      title: 'Max Tickets',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_TICKETS})`,
      description: 'Maximum number of tickets to sync',
    },
  ],

  tagDefinitions: [
    { id: 'contentType', displayName: 'Content Type', fieldType: 'text' },
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'priority', displayName: 'Priority', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
    { id: 'commentCount', displayName: 'Comment Count', fieldType: 'number' },
  ],
}
