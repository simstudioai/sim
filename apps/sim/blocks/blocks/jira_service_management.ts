import { JiraServiceManagementIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { JsmResponse } from '@/tools/jsm/types'

export const JiraServiceManagementBlock: BlockConfig<JsmResponse> = {
  type: 'jira_service_management',
  name: 'Jira Service Management',
  description: 'Interact with Jira Service Management',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate with Jira Service Management for IT service management. Create and manage service requests, handle customers and organizations, track SLAs, and manage queues.',
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
        { label: 'Get Request Types', id: 'get_request_types' },
        { label: 'Create Request', id: 'create_request' },
        { label: 'Get Request', id: 'get_request' },
        { label: 'Get Requests', id: 'get_requests' },
        { label: 'Add Comment', id: 'add_comment' },
        { label: 'Get Comments', id: 'get_comments' },
        { label: 'Get Customers', id: 'get_customers' },
        { label: 'Add Customer', id: 'add_customer' },
        { label: 'Get Organizations', id: 'get_organizations' },
        { label: 'Create Organization', id: 'create_organization' },
        { label: 'Add Organization', id: 'add_organization' },
        { label: 'Get Queues', id: 'get_queues' },
        { label: 'Get SLA', id: 'get_sla' },
        { label: 'Get Transitions', id: 'get_transitions' },
        { label: 'Transition Request', id: 'transition_request' },
        { label: 'Get Participants', id: 'get_participants' },
        { label: 'Add Participants', id: 'add_participants' },
        { label: 'Get Approvals', id: 'get_approvals' },
        { label: 'Answer Approval', id: 'answer_approval' },
      ],
      value: () => 'get_service_desks',
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Jira domain (e.g., simstudio.atlassian.net)',
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
          'get_request_types',
          'create_request',
          'get_customers',
          'add_customer',
          'get_organizations',
          'add_organization',
          'get_queues',
        ],
      },
    },
    {
      id: 'requestTypeId',
      title: 'Request Type ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter request type ID',
      condition: { field: 'operation', value: 'create_request' },
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
          'add_comment',
          'get_comments',
          'get_sla',
          'get_transitions',
          'transition_request',
          'get_participants',
          'add_participants',
          'get_approvals',
          'answer_approval',
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
      id: 'emails',
      title: 'Email Addresses',
      type: 'short-input',
      required: true,
      placeholder: 'Comma-separated email addresses',
      condition: { field: 'operation', value: 'add_customer' },
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
        { label: 'Organization', id: 'ORGANIZATION' },
      ],
      value: () => 'ALL_REQUESTS',
      condition: { field: 'operation', value: 'get_requests' },
    },
    {
      id: 'requestStatus',
      title: 'Request Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'ALL' },
        { label: 'Open', id: 'OPEN' },
        { label: 'Closed', id: 'CLOSED' },
      ],
      value: () => 'ALL',
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
      condition: { field: 'operation', value: 'add_organization' },
    },
    {
      id: 'participantAccountIds',
      title: 'Account IDs',
      type: 'short-input',
      required: true,
      placeholder: 'Comma-separated account IDs',
      condition: { field: 'operation', value: 'add_participants' },
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
          'get_comments',
          'get_customers',
          'get_organizations',
          'get_queues',
          'get_sla',
        ],
      },
    },
  ],
  tools: {
    access: [
      'jsm_get_service_desks',
      'jsm_get_request_types',
      'jsm_create_request',
      'jsm_get_request',
      'jsm_get_requests',
      'jsm_add_comment',
      'jsm_get_comments',
      'jsm_get_customers',
      'jsm_add_customer',
      'jsm_get_organizations',
      'jsm_create_organization',
      'jsm_add_organization',
      'jsm_get_queues',
      'jsm_get_sla',
      'jsm_get_transitions',
      'jsm_transition_request',
      'jsm_get_participants',
      'jsm_add_participants',
      'jsm_get_approvals',
      'jsm_answer_approval',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_service_desks':
            return 'jsm_get_service_desks'
          case 'get_request_types':
            return 'jsm_get_request_types'
          case 'create_request':
            return 'jsm_create_request'
          case 'get_request':
            return 'jsm_get_request'
          case 'get_requests':
            return 'jsm_get_requests'
          case 'add_comment':
            return 'jsm_add_comment'
          case 'get_comments':
            return 'jsm_get_comments'
          case 'get_customers':
            return 'jsm_get_customers'
          case 'add_customer':
            return 'jsm_add_customer'
          case 'get_organizations':
            return 'jsm_get_organizations'
          case 'create_organization':
            return 'jsm_create_organization'
          case 'add_organization':
            return 'jsm_add_organization'
          case 'get_queues':
            return 'jsm_get_queues'
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
          case 'get_approvals':
            return 'jsm_get_approvals'
          case 'answer_approval':
            return 'jsm_answer_approval'
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
            }
          case 'get_request':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
            }
          case 'get_requests':
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              requestOwnership: params.requestOwnership,
              requestStatus: params.requestStatus,
              searchTerm: params.searchTerm,
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
            const accountIds = params.accountIds
              ? params.accountIds
                  .split(',')
                  .map((id: string) => id.trim())
                  .filter((id: string) => id)
              : undefined
            const emails = params.emails
              ? params.emails
                  .split(',')
                  .map((email: string) => email.trim())
                  .filter((email: string) => email)
              : undefined
            if ((!accountIds || accountIds.length === 0) && (!emails || emails.length === 0)) {
              throw new Error('At least one account ID or email is required')
            }
            return {
              ...baseParams,
              serviceDeskId: params.serviceDeskId,
              accountIds,
              emails,
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
    accountIds: { type: 'string', description: 'Comma-separated account IDs' },
    emails: { type: 'string', description: 'Comma-separated email addresses' },
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
    approvalId: { type: 'string', description: 'Approval ID' },
    decision: { type: 'string', description: 'Approval decision' },
    total: { type: 'number', description: 'Total count' },
    isLastPage: { type: 'boolean', description: 'Whether this is the last page' },
  },
}
