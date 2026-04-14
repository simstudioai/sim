import { JiraServiceManagementIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
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
  integrationType: IntegrationType.CustomerSupport,
  tags: ['customer-support', 'ticketing', 'incident-management'],
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
        { label: 'Get Request Type Fields', id: 'get_request_type_fields' },
        { label: 'Get Form Templates', id: 'get_form_templates' },
        { label: 'Get Form Structure', id: 'get_form_structure' },
        { label: 'Get Issue Forms', id: 'get_issue_forms' },
        { label: 'Attach Form', id: 'attach_form' },
        { label: 'Save Form Answers', id: 'save_form_answers' },
        { label: 'Submit Form', id: 'submit_form' },
        { label: 'Get Form', id: 'get_form' },
        { label: 'Get Form Answers', id: 'get_form_answers' },
        { label: 'Reopen Form', id: 'reopen_form' },
        { label: 'Delete Form', id: 'delete_form' },
        { label: 'Externalise Form', id: 'externalise_form' },
        { label: 'Internalise Form', id: 'internalise_form' },
        { label: 'Copy Forms', id: 'copy_forms' },
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
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'jira',
      requiredScopes: getScopesForService('jira'),
      placeholder: 'Select Jira account',
    },
    {
      id: 'manualCredential',
      title: 'Jira Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'serviceDeskSelector',
      title: 'Service Desk',
      type: 'project-selector',
      canonicalParamId: 'serviceDeskId',
      serviceId: 'jira',
      selectorKey: 'jsm.serviceDesks',
      selectorAllowSearch: false,
      placeholder: 'Select service desk',
      dependsOn: ['credential', 'domain'],
      mode: 'basic',
      required: {
        field: 'operation',
        value: [
          'get_request_types',
          'create_request',
          'get_customers',
          'add_customer',
          'get_organizations',
          'add_organization',
          'get_queues',
          'get_request_type_fields',
        ],
      },
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
          'get_requests',
          'get_request_type_fields',
        ],
      },
    },
    {
      id: 'serviceDeskId',
      title: 'Service Desk ID',
      type: 'short-input',
      canonicalParamId: 'serviceDeskId',
      placeholder: 'Enter service desk ID',
      mode: 'advanced',
      required: {
        field: 'operation',
        value: [
          'get_request_types',
          'create_request',
          'get_customers',
          'add_customer',
          'get_organizations',
          'add_organization',
          'get_queues',
          'get_request_type_fields',
        ],
      },
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
          'get_requests',
          'get_request_type_fields',
        ],
      },
    },
    {
      id: 'requestTypeSelector',
      title: 'Request Type',
      type: 'file-selector',
      canonicalParamId: 'requestTypeId',
      serviceId: 'jira',
      selectorKey: 'jsm.requestTypes',
      selectorAllowSearch: false,
      placeholder: 'Select request type',
      dependsOn: ['credential', 'domain', 'serviceDeskSelector'],
      mode: 'basic',
      required: true,
      condition: { field: 'operation', value: ['create_request', 'get_request_type_fields'] },
    },
    {
      id: 'requestTypeId',
      title: 'Request Type ID',
      type: 'short-input',
      canonicalParamId: 'requestTypeId',
      required: true,
      placeholder: 'Enter request type ID',
      mode: 'advanced',
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
          'add_comment',
          'get_comments',
          'get_sla',
          'get_transitions',
          'transition_request',
          'get_participants',
          'add_participants',
          'get_approvals',
          'answer_approval',
          'get_issue_forms',
          'attach_form',
          'save_form_answers',
          'submit_form',
          'get_form',
          'get_form_answers',
          'reopen_form',
          'delete_form',
          'externalise_form',
          'internalise_form',
        ],
      },
    },
    {
      id: 'projectIdOrKey',
      title: 'Project ID or Key',
      type: 'short-input',
      required: { field: 'operation', value: ['get_form_templates', 'get_form_structure'] },
      placeholder: 'Enter Jira project ID or key (e.g., 10001 or SD)',
      condition: { field: 'operation', value: ['get_form_templates', 'get_form_structure'] },
    },
    {
      id: 'formId',
      title: 'Form ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter form ID (UUID from Get Form Templates or Attach Form)',
      condition: {
        field: 'operation',
        value: [
          'get_form_structure',
          'save_form_answers',
          'submit_form',
          'get_form',
          'get_form_answers',
          'reopen_form',
          'delete_form',
          'externalise_form',
          'internalise_form',
        ],
      },
    },
    {
      id: 'formTemplateId',
      title: 'Form Template ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter form template UUID (from Get Form Templates)',
      condition: { field: 'operation', value: 'attach_form' },
    },
    {
      id: 'sourceIssueIdOrKey',
      title: 'Source Issue ID or Key',
      type: 'short-input',
      required: true,
      placeholder: 'Issue to copy forms from (e.g., SD-123)',
      condition: { field: 'operation', value: 'copy_forms' },
    },
    {
      id: 'targetIssueIdOrKey',
      title: 'Target Issue ID or Key',
      type: 'short-input',
      required: true,
      placeholder: 'Issue to copy forms to (e.g., SD-456)',
      condition: { field: 'operation', value: 'copy_forms' },
    },
    {
      id: 'formIds',
      title: 'Form IDs to Copy',
      type: 'long-input',
      placeholder:
        'JSON array of form UUIDs (e.g., ["uuid1", "uuid2"]). Leave empty to copy all forms.',
      mode: 'advanced',
      condition: { field: 'operation', value: 'copy_forms' },
    },
    {
      id: 'summary',
      title: 'Summary',
      type: 'short-input',
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
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_request' },
    },
    {
      id: 'requestParticipants',
      title: 'Request Participants',
      type: 'short-input',
      placeholder: 'Comma-separated account IDs to add as participants',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_request' },
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'short-input',
      placeholder: 'Channel (e.g., portal, email)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_request' },
    },
    {
      id: 'requestFieldValues',
      title: 'Request Field Values',
      type: 'long-input',
      placeholder:
        'JSON object of field values (e.g., {"summary": "Title", "customfield_10010": "value"})',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_request' },
    },
    {
      id: 'formAnswers',
      title: 'Form Answers',
      type: 'long-input',
      placeholder:
        'JSON object using form question IDs as keys (e.g., {"1": {"text": "Title"}, "4": {"choices": ["5"]}, "14": {"text": "Details"}})',
      required: { field: 'operation', value: 'save_form_answers' },
      condition: { field: 'operation', value: ['create_request', 'save_form_answers'] },
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
          'get_transitions',
          'get_participants',
          'get_approvals',
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
      'jsm_get_request_type_fields',
      'jsm_get_form_templates',
      'jsm_get_form_structure',
      'jsm_get_issue_forms',
      'jsm_attach_form',
      'jsm_save_form_answers',
      'jsm_submit_form',
      'jsm_get_form',
      'jsm_get_form_answers',
      'jsm_reopen_form',
      'jsm_delete_form',
      'jsm_externalise_form',
      'jsm_internalise_form',
      'jsm_copy_forms',
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
          case 'get_request_type_fields':
            return 'jsm_get_request_type_fields'
          case 'get_form_templates':
            return 'jsm_get_form_templates'
          case 'get_form_structure':
            return 'jsm_get_form_structure'
          case 'get_issue_forms':
            return 'jsm_get_issue_forms'
          case 'attach_form':
            return 'jsm_attach_form'
          case 'save_form_answers':
            return 'jsm_save_form_answers'
          case 'submit_form':
            return 'jsm_submit_form'
          case 'get_form':
            return 'jsm_get_form'
          case 'get_form_answers':
            return 'jsm_get_form_answers'
          case 'reopen_form':
            return 'jsm_reopen_form'
          case 'delete_form':
            return 'jsm_delete_form'
          case 'externalise_form':
            return 'jsm_externalise_form'
          case 'internalise_form':
            return 'jsm_internalise_form'
          case 'copy_forms':
            return 'jsm_copy_forms'
          default:
            return 'jsm_get_service_desks'
        }
      },
      params: (params) => {
        const baseParams = {
          oauthCredential: params.oauthCredential,
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
            if (!params.summary && !params.formAnswers) {
              throw new Error('Summary is required (unless using Form Answers)')
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
                ? (() => {
                    try {
                      return JSON.parse(params.requestFieldValues)
                    } catch {
                      throw new Error('requestFieldValues must be valid JSON')
                    }
                  })()
                : undefined,
              formAnswers: params.formAnswers
                ? (() => {
                    try {
                      return JSON.parse(params.formAnswers)
                    } catch {
                      throw new Error('formAnswers must be valid JSON')
                    }
                  })()
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
          case 'get_form_templates':
            if (!params.projectIdOrKey) {
              throw new Error('Project ID or key is required')
            }
            return {
              ...baseParams,
              projectIdOrKey: params.projectIdOrKey,
            }
          case 'get_form_structure':
            if (!params.projectIdOrKey) {
              throw new Error('Project ID or key is required')
            }
            if (!params.formId) {
              throw new Error('Form ID is required')
            }
            return {
              ...baseParams,
              projectIdOrKey: params.projectIdOrKey,
              formId: params.formId,
            }
          case 'get_issue_forms':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
            }
          case 'attach_form':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.formTemplateId) {
              throw new Error('Form template ID is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              formTemplateId: params.formTemplateId,
            }
          case 'save_form_answers':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.formId) {
              throw new Error('Form ID is required')
            }
            if (!params.formAnswers) {
              throw new Error('Form answers are required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              formId: params.formId,
              answers: (() => {
                try {
                  return JSON.parse(params.formAnswers)
                } catch {
                  throw new Error('formAnswers must be valid JSON')
                }
              })(),
            }
          case 'submit_form':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.formId) {
              throw new Error('Form ID is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              formId: params.formId,
            }
          case 'get_form_answers':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.formId) {
              throw new Error('Form ID is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              formId: params.formId,
            }
          case 'reopen_form':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.formId) {
              throw new Error('Form ID is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              formId: params.formId,
            }
          case 'get_form':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.formId) {
              throw new Error('Form ID is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              formId: params.formId,
            }
          case 'delete_form':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.formId) {
              throw new Error('Form ID is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              formId: params.formId,
            }
          case 'externalise_form':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.formId) {
              throw new Error('Form ID is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              formId: params.formId,
            }
          case 'internalise_form':
            if (!params.issueIdOrKey) {
              throw new Error('Issue ID or key is required')
            }
            if (!params.formId) {
              throw new Error('Form ID is required')
            }
            return {
              ...baseParams,
              issueIdOrKey: params.issueIdOrKey,
              formId: params.formId,
            }
          case 'copy_forms':
            if (!params.sourceIssueIdOrKey) {
              throw new Error('Source issue ID or key is required')
            }
            if (!params.targetIssueIdOrKey) {
              throw new Error('Target issue ID or key is required')
            }
            return {
              ...baseParams,
              sourceIssueIdOrKey: params.sourceIssueIdOrKey,
              targetIssueIdOrKey: params.targetIssueIdOrKey,
              formIds: params.formIds
                ? (() => {
                    try {
                      const parsed = JSON.parse(params.formIds)
                      if (!Array.isArray(parsed)) {
                        throw new Error('formIds must be a JSON array')
                      }
                      return parsed
                    } catch (e) {
                      throw e instanceof Error && e.message === 'formIds must be a JSON array'
                        ? e
                        : new Error('formIds must be valid JSON array')
                    }
                  })()
                : undefined,
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
    oauthCredential: { type: 'string', description: 'Jira Service Management access token' },
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
    requestFieldValues: { type: 'string', description: 'JSON object of request field values' },
    formAnswers: {
      type: 'string',
      description: 'JSON object of form answers for form-based request types',
    },
    projectIdOrKey: { type: 'string', description: 'Jira project ID or key' },
    formId: { type: 'string', description: 'Form ID (UUID)' },
    formTemplateId: { type: 'string', description: 'Form template UUID' },
    sourceIssueIdOrKey: { type: 'string', description: 'Source issue ID or key for copy' },
    targetIssueIdOrKey: { type: 'string', description: 'Target issue ID or key for copy' },
    formIds: { type: 'string', description: 'JSON array of form UUIDs to copy' },
    searchQuery: { type: 'string', description: 'Filter request types by name' },
    groupId: { type: 'string', description: 'Filter by request type group ID' },
    expand: { type: 'string', description: 'Comma-separated fields to expand' },
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
    canAddRequestParticipants: {
      type: 'boolean',
      description: 'Whether participants can be added to this request type',
    },
    canRaiseOnBehalfOf: {
      type: 'boolean',
      description: 'Whether requests can be raised on behalf of another user',
    },
    templates: {
      type: 'json',
      description:
        'Array of form templates (id, name, updated, portalRequestTypeIds, issueCreateIssueTypeIds)',
    },
    design: {
      type: 'json',
      description:
        'Full form design with questions (labels, types, choices, validation), layout, conditions, sections, settings',
    },
    publish: {
      type: 'json',
      description: 'Form publishing and request type configuration',
    },
    updated: { type: 'string', description: 'Last updated timestamp' },
    forms: {
      type: 'json',
      description:
        'Array of forms attached to an issue (id, name, updated, submitted, lock, internal, formTemplateId)',
    },
    formId: { type: 'string', description: 'Form instance UUID' },
    formTemplateId: { type: 'string', description: 'Form template ID' },
    submitted: { type: 'boolean', description: 'Whether the form has been submitted' },
    lock: { type: 'boolean', description: 'Whether the form is locked' },
    internal: { type: 'boolean', description: 'Whether the form is internal only' },
    state: {
      type: 'json',
      description: 'Form state with status (open, submitted, locked)',
    },
    status: { type: 'string', description: 'Form status (open, submitted, locked)' },
    answers: {
      type: 'json',
      description: 'Form answers as key-value pairs (question ID to answer)',
    },
    deleted: { type: 'boolean', description: 'Whether the form was successfully deleted' },
    visibility: {
      type: 'string',
      description: 'Form visibility (internal or external)',
    },
    copiedForms: { type: 'json', description: 'Array of successfully copied forms' },
    errors: { type: 'json', description: 'Array of errors from copy forms operation' },
    sourceIssueIdOrKey: { type: 'string', description: 'Source issue ID or key' },
    targetIssueIdOrKey: { type: 'string', description: 'Target issue ID or key' },
  },
}
