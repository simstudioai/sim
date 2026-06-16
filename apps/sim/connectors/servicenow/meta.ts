import { ServiceNowIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_ITEMS = 500

export const servicenowConnectorMeta: ConnectorMeta = {
  id: 'servicenow',
  name: 'ServiceNow',
  description: 'Sync Knowledge Base articles and Incidents from ServiceNow',
  version: '1.0.0',
  icon: ServiceNowIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your ServiceNow API key or password',
  },

  configFields: [
    {
      id: 'instanceUrl',
      title: 'Instance URL',
      type: 'short-input',
      placeholder: 'yourinstance.service-now.com',
      required: true,
      description: 'Your ServiceNow instance URL',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'admin',
      required: true,
      description: 'ServiceNow username for Basic Auth',
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      required: true,
      description: 'Type of content to sync from ServiceNow',
      options: [
        { label: 'Knowledge Base Articles', id: 'kb_knowledge' },
        { label: 'Incidents', id: 'incident' },
      ],
    },
    {
      id: 'workflowState',
      title: 'Article State',
      type: 'dropdown',
      required: false,
      description: 'Filter KB articles by workflow state',
      options: [
        { label: 'All States', id: 'all' },
        { label: 'Published', id: 'published' },
        { label: 'Draft', id: 'draft' },
        { label: 'Review', id: 'review' },
        { label: 'Retired', id: 'retired' },
        { label: 'Outdated', id: 'outdated' },
      ],
    },
    {
      id: 'kbCategory',
      title: 'KB Category',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. IT, HR, General',
      description: 'Filter KB articles by category label',
    },
    {
      id: 'incidentState',
      title: 'Incident State',
      type: 'dropdown',
      required: false,
      description: 'Filter incidents by state',
      options: [
        { label: 'All States', id: 'all' },
        { label: 'New', id: '1' },
        { label: 'In Progress', id: '2' },
        { label: 'On Hold', id: '3' },
        { label: 'Resolved', id: '6' },
        { label: 'Closed', id: '7' },
        { label: 'Canceled', id: '8' },
      ],
    },
    {
      id: 'incidentPriority',
      title: 'Incident Priority',
      type: 'dropdown',
      required: false,
      description: 'Filter incidents by priority',
      options: [
        { label: 'All Priorities', id: 'all' },
        { label: 'Critical', id: '1' },
        { label: 'High', id: '2' },
        { label: 'Moderate', id: '3' },
        { label: 'Low', id: '4' },
        { label: 'Planning', id: '5' },
      ],
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_ITEMS})`,
      description: 'Maximum number of items to sync',
    },
  ],

  tagDefinitions: [
    { id: 'type', displayName: 'Record Type', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'priority', displayName: 'Priority', fieldType: 'text' },
    { id: 'category', displayName: 'Category', fieldType: 'text' },
    { id: 'author', displayName: 'Author', fieldType: 'text' },
    { id: 'lastUpdated', displayName: 'Last Updated', fieldType: 'date' },
  ],
}
