import { JiraServiceManagementIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { JsmResponse } from '@/tools/jsm/types'
import { getTrigger } from '@/triggers'

export const JiraServiceManagementBlock: BlockConfig<JsmResponse> = {
  type: 'jira_service_management',
  name: 'Jira Service Management',
  description: 'Interact with Jira Service Management',
  authMode: AuthMode.OAuth,
  triggerAllowed: true,
  longDescription:
    'Integrate with Jira Service Management for IT service management. Create and manage service requests, handle customers and organizations, track SLAs, and manage queues. Can also trigger workflows based on Jira Service Management webhook events.',
  docsLink: 'https://docs.sim.ai/tools/jira-service-management',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: JiraServiceManagementIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Service Desks', id: 'get_service_desks' },
        { label: 'Get Service Desk', id: 'get_service_desk' },
        { label: 'Get Request Types', id: 'get_request_types' },
        { label: 'Get Request Type Fields', id: 'get_request_type_fields' },
        { label: 'Create Request', id: 'create_request' },
        { label: 'Get Request', id: 'get_request' },
        { label: 'Get Requests', id: 'get_requests' },
        { label: 'Get Request Status', id: 'get_request_status' },
        { label: 'Get Request Attachments', id: 'get_request_attachments' },
        { label: 'Add Comment', id: 'add_comment' },
        { label: 'Get Comments', id: 'get_comments' },
        { label: 'Get Customers', id: 'get_customers' },
        { label: 'Add Customer', id: 'add_customer' },
        { label: 'Remove Customer', id: 'remove_customer' },
        { label: 'Create Customer', id: 'create_customer' },
        { label: 'Get Organizations', id: 'get_organizations' },
        { label: 'Get Organization', id: 'get_organization' },
        { label: 'Create Organization', id: 'create_organization' },
        { label: 'Add Organization', id: 'add_organization' },
        { label: 'Remove Organization', id: 'remove_organization' },
        { label: 'Delete Organization', id: 'delete_organization' },
        { label: 'Get Organization Users', id: 'get_organization_users' },
        { label: 'Add Organization Users', id: 'add_organization_users' },
        { label: 'Remove Organization Users', id: 'remove_organization_users' },
        { label: 'Get Queues', id: 'get_queues' },
        { label: 'Get Queue Issues', id: 'get_queue_issues' },
        { label: 'Get SLA', id: 'get_sla' },
        { label: 'Get Transitions', id: 'get_transitions' },
        { label: 'Transition Request', id: 'transition_request' },
        { label: 'Get Participants', id: 'get_participants' },
        { label: 'Add Participants', id: 'add_participants' },
        { label: 'Remove Participants', id: 'remove_participants' },
        { label: 'Get Approvals', id: 'get_approvals' },
        { label: 'Answer Approval', id: 'answer_approval' },
        { label: 'Get Feedback', id: 'get_feedback' },
        { label: 'Add Feedback', id: 'add_feedback' },
        { label: 'Delete Feedback', id: 'delete_feedback' },
        { label: 'Get Notification', id: 'get_notification' },
        { label: 'Subscribe Notification', id: 'subscribe_notification' },
        { label: 'Unsubscribe Notification', id: 'unsubscribe_notification' },
        { label: 'Search Knowledge Base', id: 'search_knowledge_base' },
      ],
      value: () => 'get_service_desks',
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Jira domain (e.g., company.atlassian.net)',
    },
    {
      id: 'credential',
      title: 'Jira Account',
      type: 'oauth-input',
      required: true,
      serviceId: 'jira',
      requiredScopes: [
        'read:jira-user',
        'read:jira-work',
        'write:jira-work',
        'read:project:jira',
        'read:me',
        'offline_access',
        'read:issue:jira',
        'read:status:jira',
        'read:user:jira',
        'read:issue-details:jira',
        'write:comment:jira',
        'read:comment:jira',
        'read:servicedesk:jira-service-management',
        'read:requesttype:jira-service-management',
        'read:request:jira-service-management',
        'write:request:jira-service-management',
        'read:request.comment:jira-service-management',
        'write:request.comment:jira-service-management',
        'read:customer:jira-service-management',
        'write:customer:jira-service-management',
        'read:servicedesk.customer:jira-service-management',
        'write:servicedesk.customer:jira-service-management',
        'read:organization:jira-service-management',
        'write:organization:jira-service-management',
        'read:servicedesk.organization:jira-service-management',
        'write:servicedesk.organization:jira-service-management',
        'read:queue:jira-service-management',
        'read:request.sla:jira-service-management',
        'read:request.status:jira-service-management',
        'write:request.status:jira-service-management',
        'read:request.participant:jira-service-management',
        'write:request.participant:jira-service-management',
        'read:request.approval:jira-service-management',
        'write:request.approval:jira-service-management',
        'read:request.feedback:jira-service-management',
        'write:request.feedback:jira-service-management',
        'delete:request.feedback:jira-service-management',
        'read:request.notification:jira-service-management',
        'write:request.notification:jira-service-management',
        'delete:request.notification:jira-service-management',
        'read:request.attachment:jira-service-management',
        'read:knowledgebase:jira-service-management',
        'read:organization.user:jira-service-management',
        'write:organization.user:jira-service-management',
        'delete:organization:jira-service-management',
        'delete:servicedesk.customer:jira-service-management',
      ],
      placeholder: 'Select Jira account',
    },
    {
      id: 'serviceDeskId',
      title: 'Service Desk ID',
      type: 'short-input',
      placeholder: 'Enter service desk ID',
      condition: {
        field: 'operation',
        value: [
          'get_service_desk',
          'get_request_types',
          'create_request',
          'get_customers',
          'add_customer',
          'remove_customer',
          'get_organizations',
          'add_organization',
          'remove_organization',
          'get_queues',
          'get_queue_issues',
          'get_requests',
          'get_request_type_fields',
          'search_knowledge_base',
        ],
      },
    },
    {
      id: 'requestTypeId',
      title: 'Request Type ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter request type ID',
      condition: { field: 'operation', value: ['create_request', 'get_request_type_fields'] },
    },
    {
      id: 'issueIdOrKey',
      title: 'Issue ID or Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter issue ID or key (e.g., SD-123)',
      condition: {
        field: 'operation',
        value: [
          'get_request',
          'get_request_status',
          'get_request_attachments',
          'add_comment',
          'get_comments',
          'get_sla',
          'get_transitions',
          'transition_request',
          'get_participants',
          'add_participants',
          'remove_participants',
          'get_approvals',
          'answer_approval',
          'get_feedback',
          'add_feedback',
          'delete_feedback',
          'get_notification',
          'subscribe_notification',
          'unsubscribe_notification',
        ],
      },
    },
    {
      id: 'summary',
      title: 'Summary',
      type: 'short-input',
      required: true,
      placeholder: 'Enter request summary',
      condition: { field: 'operation', value: 'create_request' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a concise service request summary based on the user's description.
The summary should:
- Be clear and descriptive
- Capture the essence of the request
- Be suitable for service desk tracking

Return ONLY the summary text - no explanations.`,
        placeholder:
          'Describe the service request (e.g., "need VPN access", "laptop keyboard not working")...',
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter request description',
      condition: { field: 'operation', value: 'create_request' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a detailed service request description based on the user's description.
The description should:
- Provide context and details about the request
- Include relevant information for the service desk agent
- Be professional and clear

Return ONLY the description text - no explanations.`,
        placeholder:
          'Describe the request details (e.g., "need access to shared drive for new project")...',
      },
    },
    {
      id: 'raiseOnBehalfOf',
      title: 'Raise on Behalf Of',
      type: 'short-input',
      placeholder: 'Account ID to raise request on behalf of',
      condition: { field: 'operation', value: 'create_request' },
    },
    {
      id: 'requestParticipants',
      title: 'Request Participants',
      type: 'short-input',
      placeholder: 'Comma-separated account IDs to add as participants',
      condition: { field: 'operation', value: 'create_request' },
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'short-input',
      placeholder: 'Channel (e.g., portal, email)',
      condition: { field: 'operation', value: 'create_request' },
    },
    {
      id: 'requestFieldValues',
      title: 'Custom Field Values',
      type: 'long-input',
      placeholder: 'JSON object of custom field values (e.g., {"customfield_10010": "value"})',
      condition: { field: 'operation', value: 'create_request' },
    },
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Filter request types by name',
      condition: { field: 'operation', value: 'get_request_types' },
    },
    {
      id: 'groupId',
      title: 'Group ID',
      type: 'short-input',
      placeholder: 'Filter by request type group',
      condition: { field: 'operation', value: 'get_request_types' },
    },
    {
      id: 'expand',
      title: 'Expand',
      type: 'short-input',
      placeholder: 'Comma-separated fields to expand',
      condition: {
        field: 'operation',
        value: ['get_request', 'get_requests', 'get_comments'],
      },
    },
    {
      id: 'commentBody',
      title: 'Comment',
      type: 'long-input',
      required: true,
      placeholder: 'Enter comment text',
      condition: { field: 'operation', value: 'add_comment' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a service request comment based on the user's description.
The comment should:
- Be professional and helpful
- Provide relevant information or updates
- Be suitable for customer or internal communication

Return ONLY the comment text - no explanations.`,
        placeholder:
          'Describe what you want to communicate (e.g., "update on ticket progress", "request more information")...',
      },
    },
    {
      id: 'isPublic',
      title: 'Comment Visibility',
      type: 'dropdown',
      options: [
        { label: 'Public (visible to customer)', id: 'true' },
        { label: 'Internal (agents only)', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'add_comment' },
    },
    {
      id: 'accountIds',
      title: 'Account IDs',
      type: 'short-input',
      required: true,
      placeholder: 'Comma-separated Atlassian account IDs',
      condition: {
        field: 'operation',
        value: [
          'add_customer',
          'remove_customer',
          'add_organization_users',
          'remove_organization_users',
        ],
      },
    },
    {
      id: 'customerQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search customers by name or email',
      condition: { field: 'operation', value: 'get_customers' },
    },
    {
      id: 'transitionId',
      title: 'Transition ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter transition ID',
      condition: { field: 'operation', value: 'transition_request' },
    },
    {
      id: 'transitionComment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Add optional comment during transition',
      condition: { field: 'operation', value: 'transition_request' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a transition comment for a service request based on the user's description.
The comment should:
- Explain the reason for the status change
- Provide any relevant context
- Be professional and informative

Return ONLY the comment text - no explanations.`,
        placeholder:
          'Describe the transition reason (e.g., "resolved issue", "waiting for customer input")...',
      },
    },
    {
      id: 'requestOwnership',
      title: 'Request Ownership',
      type: 'dropdown',
      options: [
        { label: 'All Requests', id: 'ALL_REQUESTS' },
        { label: 'My Requests', id: 'OWNED_REQUESTS' },
        { label: 'Participated', id: 'PARTICIPATED_REQUESTS' },
        { label: 'Approver', id: 'APPROVER' },
      ],
      value: () => 'ALL_REQUESTS',
      condition: { field: 'operation', value: 'get_requests' },
    },
    {
      id: 'requestStatus',
      title: 'Request Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'ALL_REQUESTS' },
        { label: 'Open', id: 'OPEN_REQUESTS' },
        { label: 'Closed', id: 'CLOSED_REQUESTS' },
      ],
      value: () => 'ALL_REQUESTS',
      condition: { field: 'operation', value: 'get_requests' },
    },
    {
      id: 'searchTerm',
      title: 'Search Term',
      type: 'short-input',
      placeholder: 'Search requests',
      condition: { field: 'operation', value: 'get_requests' },
    },
    {
      id: 'includeCount',
      title: 'Include Issue Count',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'get_queues' },
    },
    {
      id: 'organizationName',
      title: 'Organization Name',
      type: 'short-input',
      required: true,
      placeholder: 'Enter organization name',
      condition: { field: 'operation', value: 'create_organization' },
    },
    {
      id: 'organizationId',
      title: 'Organization ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter organization ID',
      condition: {
        field: 'operation',
        value: [
          'add_organization',
          'remove_organization',
          'delete_organization',
          'get_organization',
          'get_organization_users',
          'add_organization_users',
          'remove_organization_users',
        ],
      },
    },
    {
      id: 'participantAccountIds',
      title: 'Account IDs',
      type: 'short-input',
      required: true,
      placeholder: 'Comma-separated account IDs',
      condition: { field: 'operation', value: ['add_participants', 'remove_participants'] },
    },
    {
      id: 'approvalId',
      title: 'Approval ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter approval ID',
      condition: { field: 'operation', value: 'answer_approval' },
    },
    {
      id: 'approvalDecision',
      title: 'Decision',
      type: 'dropdown',
      options: [
        { label: 'Approve', id: 'approve' },
        { label: 'Decline', id: 'decline' },
      ],
      value: () => 'approve',
      condition: { field: 'operation', value: 'answer_approval' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Maximum results (default: 50)',
      condition: {
        field: 'operation',
        value: [
          'get_service_desks',
          'get_request_types',
          'get_requests',
          'get_request_status',
          'get_request_attachments',
          'get_comments',
          'get_customers',
          'get_organizations',
          'get_organization_users',
          'get_queues',
          'get_queue_issues',
          'get_sla',
          'get_transitions',
          'get_participants',
          'get_approvals',
          'search_knowledge_base',
        ],
      },
    },
    {
      id: 'queueId',
      title: 'Queue ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter queue ID',
      condition: { field: 'operation', value: 'get_queue_issues' },
    },
    {
      id: 'customerEmail',
      title: 'Customer Email',
      type: 'short-input',
      required: true,
      placeholder: 'Enter customer email address',
      condition: { field: 'operation', value: 'create_customer' },
    },
    {
      id: 'customerDisplayName',
      title: 'Display Name',
      type: 'short-input',
      required: true,
      placeholder: 'Enter customer display name',
      condition: { field: 'operation', value: 'create_customer' },
    },
    {
      id: 'knowledgeBaseQuery',
      title: 'Search Query',
      type: 'short-input',
      required: true,
      placeholder: 'Search knowledge base articles',
      condition: { field: 'operation', value: 'search_knowledge_base' },
    },
    {
      id: 'feedbackRating',
      title: 'Rating',
      type: 'dropdown',
      options: [
        { label: '1 - Very Unsatisfied', id: '1' },
        { label: '2 - Unsatisfied', id: '2' },
        { label: '3 - Neutral', id: '3' },
        { label: '4 - Satisfied', id: '4' },
        { label: '5 - Very Satisfied', id: '5' },
      ],
      value: () => '5',
      condition: { field: 'operation', value: 'add_feedback' },
    },
    {
      id: 'feedbackComment',
      title: 'Feedback Comment',
      type: 'long-input',
      placeholder: 'Optional feedback comment',
      condition: { field: 'operation', value: 'add_feedback' },
    },
    {
      id: 'includeAttachments',
      title: 'Include File Content',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'get_request_attachments' },
    },
    // Trigger SubBlocks
    ...getTrigger('jsm_request_created').subBlocks,
    ...getTrigger('jsm_request_updated').subBlocks,
    ...getTrigger('jsm_request_deleted').subBlocks,
    ...getTrigger('jsm_request_commented').subBlocks,
    ...getTrigger('jsm_comment_updated').subBlocks,
    ...getTrigger('jsm_comment_deleted').subBlocks,
    ...getTrigger('jsm_worklog_created').subBlocks,
    ...getTrigger('jsm_worklog_updated').subBlocks,
    ...getTrigger('jsm_worklog_deleted').subBlocks,
    ...getTrigger('jsm_attachment_created').subBlocks,
    ...getTrigger('jsm_attachment_deleted').subBlocks,
    ...getTrigger('jsm_webhook').subBlocks,
  ],
  tools: {
    access: [
      'jsm_get_service_desks',
      'jsm_get_service_desk',
      'jsm_get_request_types',
      'jsm_get_request_type_fields',
      'jsm_create_request',
      'jsm_get_request',
      'jsm_get_requests',
      'jsm_get_request_status',
      'jsm_get_request_attachments',
      'jsm_add_comment',
      'jsm_get_comments',
      'jsm_get_customers',
      'jsm_add_customer',
      'jsm_remove_customer',
      'jsm_create_customer',
      'jsm_get_organizations',
      'jsm_get_organization',
      'jsm_create_organization',
      'jsm_add_organization',
      'jsm_remove_organization',
      'jsm_delete_organization',
      'jsm_get_organization_users',
      'jsm_add_organization_users',
      'jsm_remove_organization_users',
      'jsm_get_queues',
      'jsm_get_queue_issues',
      'jsm_get_sla',
      'jsm_get_transitions',
      'jsm_transition_request',
      'jsm_get_participants',
      'jsm_add_participants',
      'jsm_remove_participants',
      'jsm_get_approvals',
      'jsm_answer_approval',
      'jsm_get_feedback',
      'jsm_add_feedback',
      'jsm_delete_feedback',
      'jsm_get_notification',
      'jsm_subscribe_notification',
      'jsm_unsubscribe_notification',
      'jsm_search_knowledge_base',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_service_desks':
            return 'jsm_get_service_desks'
          case 'get_service_desk':
            return 'jsm_get_service_desk'
          case 'get_request_types':
            return 'jsm_get_request_types'
          case 'get_request_type_fields':
            return 'jsm_get_request_type_fields'
          case 'create_request':
            return 'jsm_create_request'
          case 'get_request':
            return 'jsm_get_request'
          case 'get_requests':
            return 'jsm_get_requests'
          case 'get_request_status':
            return 'jsm_get_request_status'
          case 'get_request_attachments':
            return 'jsm_get_request_attachments'
          case 'add_comment':
            return 'jsm_add_comment'
          case 'get_comments':
            return 'jsm_get_comments'
          case 'get_customers':
            return 'jsm_get_customers'
          case 'add_customer':
            return 'jsm_add_customer'
          case 'remove_customer':
            return 'jsm_remove_customer'
          case 'create_customer':
            return 'jsm_create_customer'
          case 'get_organizations':
            return 'jsm_get_organizations'
          case 'get_organization':
            return 'jsm_get_organization'
          case 'create_organization':
            return 'jsm_create_organization'
          case 'add_organization':
            return 'jsm_add_organization'
          case 'remove_organization':
            return 'jsm_remove_organization'
          case 'delete_organization':
            return 'jsm_delete_organization'
          case 'get_organization_users':
            return 'jsm_get_organization_users'
          case 'add_organization_users':
            return 'jsm_add_organization_users'
          case 'remove_organization_users':
            return 'jsm_remove_organization_users'
          case 'get_queues':
            return 'jsm_get_queues'
          case 'get_queue_issues':
            return 'jsm_get_queue_issues'
          case 'get_sla':
            return 'jsm_get_sla'
          case 'get_transitions':
            return 'jsm_get_transitions'
          case 'transition_request':
            return 'jsm_transition_request'
          case 'get_participants':
            return 'jsm_get_participants'
          case 'add_participants':
            return 'jsm_add_participants'
          case 'remove_participants':
            return 'jsm_remove_participants'
          case 'get_approvals':
            return 'jsm_get_approvals'
          case 'answer_approval':
            return 'jsm_answer_approval'
          case 'get_feedback':
            return 'jsm_get_feedback'
          case 'add_feedback':
            return 'jsm_add_feedback'
          case 'delete_feedback':
            return 'jsm_delete_feedback'
          case 'get_notification':
            return 'jsm_get_notification'
          case 'subscribe_notification':
            return 'jsm_subscribe_notification'
          case 'unsubscribe_notification':
            return 'jsm_unsubscribe_notification'
          case 'search_knowledge_base':
            return 'jsm_search_knowledge_base'
          default:
            return 'jsm_get_service_desks'
        }
      },
      params: (params) => {
        const baseParams = {
          credential: params.credential,
          domain: params.domain,
        }

        switch (params.operation) {
          case 'get_service_desks':
            return {
              ...baseParams,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'get_request_types':
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              searchQuery: params.searchQuery,
              groupId: params.groupId,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'create_request':
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            if (!params.requestTypeId) {
              throw new Error('Request Type ID is required')
            }
            if (!params.summary) {
              throw new Error('Summary is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              requestTypeId: params.requestTypeId,
              summary: params.summary,
              description: params.description,
              raiseOnBehalfOf: params.raiseOnBehalfOf,
              requestParticipants: params.requestParticipants,
              channel: params.channel,
              requestFieldValues: params.requestFieldValues
                ? JSON.parse(params.requestFieldValues)
                : undefined,
            }
          case 'get_request':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              expand: params.expand,
            }
          case 'get_requests':
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              requestOwnership: params.requestOwnership,
              requestStatus: params.requestStatus,
              searchTerm: params.searchTerm,
              expand: params.expand,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'add_comment':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.commentBody) {
              throw new Error('Comment body is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              body: params.commentBody,
              isPublic: params.isPublic === 'true',
            }
          case 'get_comments':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              expand: params.expand,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'get_customers':
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              query: params.customerQuery,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'add_customer': {
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            if (!params.accountIds && !params.emails) {
              throw new Error('Account IDs or emails are required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              accountIds: params.accountIds,
              emails: params.emails,
            }
          }
          case 'get_organizations':
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'get_queues':
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              includeCount: params.includeCount === 'true',
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'get_sla':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'get_transitions':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'transition_request':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.transitionId) {
              throw new Error('Transition ID is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              transitionId: params.transitionId,
              comment: params.transitionComment,
            }
          case 'create_organization':
            if (!params.organizationName) {
              throw new Error('Organization name is required')
            }
            return {
              ...baseParams,
              name: params.organizationName,
            }
          case 'add_organization':
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            if (!params.organizationId) {
              throw new Error('Organization ID is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              organizationId: params.organizationId,
            }
          case 'get_participants':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'add_participants':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.participantAccountIds) {
              throw new Error('Account IDs are required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              accountIds: params.participantAccountIds,
            }
          case 'get_approvals':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'answer_approval':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.approvalId) {
              throw new Error('Approval ID is required')
            }
            if (!params.approvalDecision) {
              throw new Error('Decision is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              approvalId: params.approvalId,
              decision: params.approvalDecision,
            }
          case 'get_request_type_fields':
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            if (!params.requestTypeId) {
              throw new Error('Request Type ID is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              requestTypeId: params.requestTypeId,
            }
          case 'get_service_desk':
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
            }
          case 'get_request_status':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'get_request_attachments':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              includeAttachments: params.includeAttachments === 'true',
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'remove_customer': {
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            if (!params.accountIds) {
              throw new Error('Account IDs are required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              accountIds: params.accountIds,
            }
          }
          case 'create_customer':
            if (!params.customerEmail) {
              throw new Error('Customer email is required')
            }
            if (!params.customerDisplayName) {
              throw new Error('Customer display name is required')
            }
            return {
              ...baseParams,
              email: params.customerEmail,
              displayName: params.customerDisplayName,
            }
          case 'get_organization':
            if (!params.organizationId) {
              throw new Error('Organization ID is required')
            }
            return {
              ...baseParams,
              organizationId: params.organizationId,
            }
          case 'remove_organization':
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            if (!params.organizationId) {
              throw new Error('Organization ID is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              organizationId: params.organizationId,
            }
          case 'delete_organization':
            if (!params.organizationId) {
              throw new Error('Organization ID is required')
            }
            return {
              ...baseParams,
              organizationId: params.organizationId,
            }
          case 'get_organization_users':
            if (!params.organizationId) {
              throw new Error('Organization ID is required')
            }
            return {
              ...baseParams,
              organizationId: params.organizationId,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'add_organization_users':
            if (!params.organizationId) {
              throw new Error('Organization ID is required')
            }
            if (!params.accountIds) {
              throw new Error('Account IDs are required')
            }
            return {
              ...baseParams,
              organizationId: params.organizationId,
              accountIds: params.accountIds,
            }
          case 'remove_organization_users':
            if (!params.organizationId) {
              throw new Error('Organization ID is required')
            }
            if (!params.accountIds) {
              throw new Error('Account IDs are required')
            }
            return {
              ...baseParams,
              organizationId: params.organizationId,
              accountIds: params.accountIds,
            }
          case 'get_queue_issues':
            if (!params.serviceDeskId) {
              throw new Error('Service Desk ID is required')
            }
            if (!params.queueId) {
              throw new Error('Queue ID is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              queueId: params.queueId,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          case 'remove_participants':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.participantAccountIds) {
              throw new Error('Account IDs are required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              accountIds: params.participantAccountIds,
            }
          case 'get_feedback':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
            }
          case 'add_feedback':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              rating: Number.parseInt(params.feedbackRating || '5'),
              comment: params.feedbackComment,
            }
          case 'delete_feedback':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
            }
          case 'get_notification':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
            }
          case 'subscribe_notification':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
            }
          case 'unsubscribe_notification':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
            }
          case 'search_knowledge_base':
            if (!params.knowledgeBaseQuery) {
              throw new Error('Search query is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              query: params.knowledgeBaseQuery,
              limit: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    domain: { type: 'string', description: 'Jira domain' },
    credential: { type: 'string', description: 'Jira Service Management access token' },
    serviceDeskId: { type: 'string', description: 'Service desk ID' },
    requestTypeId: { type: 'string', description: 'Request type ID' },
    issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
    summary: { type: 'string', description: 'Request summary' },
    description: { type: 'string', description: 'Request description' },
    raiseOnBehalfOf: { type: 'string', description: 'Account ID to raise request on behalf of' },
    commentBody: { type: 'string', description: 'Comment text' },
    isPublic: { type: 'string', description: 'Whether comment is public or internal' },
    accountIds: { type: 'string', description: 'Comma-separated Atlassian account IDs' },
    emails: {
      type: 'string',
      description: 'Comma-separated email addresses',
    },
    customerQuery: { type: 'string', description: 'Customer search query' },
    transitionId: { type: 'string', description: 'Transition ID' },
    transitionComment: { type: 'string', description: 'Transition comment' },
    requestOwnership: { type: 'string', description: 'Request ownership filter' },
    requestStatus: { type: 'string', description: 'Request status filter' },
    searchTerm: { type: 'string', description: 'Search term for requests' },
    includeCount: { type: 'string', description: 'Include issue count for queues' },
    maxResults: { type: 'string', description: 'Maximum results to return' },
    organizationName: { type: 'string', description: 'Organization name' },
    organizationId: { type: 'string', description: 'Organization ID' },
    participantAccountIds: {
      type: 'string',
      description: 'Comma-separated account IDs for participants',
    },
    approvalId: { type: 'string', description: 'Approval ID' },
    approvalDecision: { type: 'string', description: 'Approval decision (approve/decline)' },
    requestParticipants: {
      type: 'string',
      description: 'Comma-separated account IDs for request participants',
    },
    channel: { type: 'string', description: 'Channel (e.g., portal, email)' },
    requestFieldValues: { type: 'string', description: 'JSON object of custom field values' },
    searchQuery: { type: 'string', description: 'Filter request types by name' },
    groupId: { type: 'string', description: 'Filter by request type group ID' },
    expand: { type: 'string', description: 'Comma-separated fields to expand' },
    queueId: { type: 'string', description: 'Queue ID' },
    customerEmail: { type: 'string', description: 'Customer email address' },
    customerDisplayName: { type: 'string', description: 'Customer display name' },
    knowledgeBaseQuery: { type: 'string', description: 'Knowledge base search query' },
    feedbackRating: { type: 'string', description: 'CSAT feedback rating (1-5)' },
    feedbackComment: { type: 'string', description: 'CSAT feedback comment' },
    includeAttachments: {
      type: 'string',
      description: 'Whether to download attachment file content',
    },
  },
  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    serviceDesks: { type: 'json', description: 'Array of service desks' },
    requestTypes: { type: 'json', description: 'Array of request types' },
    issueId: { type: 'string', description: 'Issue ID' },
    issueKey: { type: 'string', description: 'Issue key (e.g., SD-123)' },
    request: { type: 'json', description: 'Request object' },
    requests: { type: 'json', description: 'Array of requests' },
    url: { type: 'string', description: 'URL to the request' },
    commentId: { type: 'string', description: 'Comment ID' },
    body: { type: 'string', description: 'Comment body' },
    isPublic: { type: 'boolean', description: 'Whether comment is public' },
    comments: { type: 'json', description: 'Array of comments' },
    customers: { type: 'json', description: 'Array of customers' },
    organizations: { type: 'json', description: 'Array of organizations' },
    organizationId: { type: 'string', description: 'Created organization ID' },
    name: { type: 'string', description: 'Organization name' },
    queues: { type: 'json', description: 'Array of queues' },
    slas: { type: 'json', description: 'Array of SLA information' },
    transitions: { type: 'json', description: 'Array of available transitions' },
    transitionId: { type: 'string', description: 'Applied transition ID' },
    participants: { type: 'json', description: 'Array of participants' },
    approvals: { type: 'json', description: 'Array of approvals' },
    approval: { type: 'json', description: 'Approval object' },
    approvalId: { type: 'string', description: 'Approval ID' },
    decision: { type: 'string', description: 'Approval decision' },
    total: { type: 'number', description: 'Total count' },
    isLastPage: { type: 'boolean', description: 'Whether this is the last page' },
    requestTypeFields: { type: 'json', description: 'Array of request type fields' },
    rating: { type: 'number', description: 'CSAT feedback rating' },
    subscribed: { type: 'boolean', description: 'Whether subscribed to notifications' },
    articles: { type: 'json', description: 'Array of knowledge base articles' },
    statuses: { type: 'json', description: 'Array of request status history entries' },
    attachments: { type: 'json', description: 'Array of attachment metadata' },
    issues: { type: 'json', description: 'Array of queue issues' },
    users: { type: 'json', description: 'Array of organization users' },
    id: { type: 'string', description: 'Resource ID' },
    projectId: { type: 'string', description: 'Service desk project ID' },
    projectName: { type: 'string', description: 'Service desk project name' },
    projectKey: { type: 'string', description: 'Service desk project key' },
    email: { type: 'string', description: 'Customer email address' },
    displayName: { type: 'string', description: 'Customer display name' },
    canAddRequestParticipants: {
      type: 'boolean',
      description: 'Whether participants can be added to this request type',
    },
    canRaiseOnBehalfOf: {
      type: 'boolean',
      description: 'Whether requests can be raised on behalf of another user',
    },
    // Trigger outputs (from webhook events)
    webhookEvent: { type: 'string', description: 'Webhook event type' },
    issue: { type: 'json', description: 'Complete issue object from webhook' },
    changelog: { type: 'json', description: 'Changelog object (for update events)' },
    comment: { type: 'json', description: 'Comment object (for comment events)' },
    worklog: { type: 'json', description: 'Worklog object (for worklog events)' },
    attachment: { type: 'json', description: 'Attachment metadata (for attachment events)' },
    files: {
      type: 'file[]',
      description:
        'Downloaded file attachments (if includeFiles is enabled and Jira credentials are provided)',
    },
    user: { type: 'json', description: 'User object who triggered the event' },
    webhook: { type: 'json', description: 'Complete webhook payload' },
  },
  triggers: {
    enabled: true,
    available: [
      'jsm_request_created',
      'jsm_request_updated',
      'jsm_request_deleted',
      'jsm_request_commented',
      'jsm_comment_updated',
      'jsm_comment_deleted',
      'jsm_worklog_created',
      'jsm_worklog_updated',
      'jsm_worklog_deleted',
      'jsm_attachment_created',
      'jsm_attachment_deleted',
      'jsm_webhook',
    ],
  },
}
