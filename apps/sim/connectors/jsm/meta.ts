import { JiraServiceManagementIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const jsmConnectorMeta: ConnectorMeta = {
  id: 'jsm',
  name: 'Jira Service Management',
  description: 'Sync service desk requests from Jira Service Management into your knowledge base',
  version: '1.0.0',
  icon: JiraServiceManagementIcon,

  auth: {
    mode: 'oauth',
    provider: 'jira',
    requiredScopes: [
      /**
       * Atlassian enforces granular scope sets all-or-nothing; the classic scope
       * alone authorizes the request read endpoints, so require it to flag stale
       * credentials that predate it in the provider scope list.
       */
      'read:servicedesk-request',
      'read:servicedesk:jira-service-management',
      'read:request:jira-service-management',
      'read:request.comment:jira-service-management',
      'read:request.status:jira-service-management',
      /**
       * Requests embed a `reporter` user object whose `displayName` is surfaced
       * in document content and the Reporter tag. Atlassian only populates
       * embedded user data when the user-read scope is granted, so request it
       * here. Present in the `jira` OAuth provider config as `read:jira-user`.
       */
      'read:jira-user',
      'offline_access',
    ],
  },

  configFields: [
    {
      id: 'domain',
      title: 'Jira Domain',
      type: 'short-input',
      placeholder: 'yoursite.atlassian.net',
      required: true,
    },
    {
      id: 'serviceDeskSelector',
      title: 'Service Desk',
      type: 'selector',
      selectorKey: 'jsm.serviceDesks',
      canonicalParamId: 'serviceDeskId',
      mode: 'basic',
      dependsOn: ['domain'],
      placeholder: 'Select a service desk',
      required: true,
    },
    {
      id: 'serviceDeskId',
      title: 'Service Desk ID',
      type: 'short-input',
      canonicalParamId: 'serviceDeskId',
      mode: 'advanced',
      placeholder: 'e.g. 1, 2',
      required: true,
    },
    {
      id: 'requestTypeSelector',
      title: 'Request Type',
      type: 'selector',
      selectorKey: 'jsm.requestTypes',
      canonicalParamId: 'requestTypeId',
      mode: 'basic',
      dependsOn: ['domain', 'serviceDeskSelector'],
      placeholder: 'All request types',
      required: false,
    },
    {
      id: 'requestTypeId',
      title: 'Request Type ID',
      type: 'short-input',
      canonicalParamId: 'requestTypeId',
      mode: 'advanced',
      placeholder: 'e.g. 10 (leave blank for all)',
      required: false,
    },
    {
      id: 'requestStatus',
      title: 'Request Status',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'All requests', id: 'ALL_REQUESTS' },
        { label: 'Open requests', id: 'OPEN_REQUESTS' },
        { label: 'Closed requests', id: 'CLOSED_REQUESTS' },
      ],
    },
    {
      id: 'requestOwnership',
      title: 'Request Ownership',
      type: 'dropdown',
      required: false,
      description:
        'Which requests the connected account can see. "Owned + participated" is the broadest scope a customer token can sync.',
      options: [
        { label: 'Owned + participated', id: 'ALL_REQUESTS' },
        { label: 'Owned only', id: 'OWNED_REQUESTS' },
        { label: 'Participated only', id: 'PARTICIPATED_REQUESTS' },
      ],
    },
    {
      id: 'comments',
      title: 'Include Comments',
      type: 'dropdown',
      required: false,
      description: 'Comments require an extra API call per request during sync.',
      options: [
        { label: 'Public comments only', id: 'public' },
        { label: 'All comments (incl. internal)', id: 'all' },
        { label: 'No comments', id: 'none' },
      ],
    },
    {
      id: 'searchTerm',
      title: 'Search Filter',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. password reset (optional)',
    },
    {
      id: 'maxRequests',
      title: 'Max Requests',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'requestTypeId', displayName: 'Request Type', fieldType: 'text' },
    { id: 'reporter', displayName: 'Reporter', fieldType: 'text' },
    { id: 'created', displayName: 'Created', fieldType: 'date' },
    { id: 'updated', displayName: 'Last Status Change', fieldType: 'date' },
  ],
}
