import { IroncladIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const IroncladBlock: BlockConfig = {
  type: 'ironclad',
  name: 'Ironclad',
  description: 'Contract lifecycle management with Ironclad',
  longDescription:
    'Manage workflows and records in Ironclad. Create and track contract workflows, manage records, view approvals, add comments, and update metadata. Requires an Ironclad OAuth connection.',
  docsLink: 'https://docs.sim.ai/tools/ironclad',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  tags: ['e-signatures', 'document-processing'],
  bgColor: '#FFFFFF',
  icon: IroncladIcon,
  authMode: AuthMode.OAuth,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Workflow', id: 'create_workflow' },
        { label: 'List Workflows', id: 'list_workflows' },
        { label: 'Get Workflow', id: 'get_workflow' },
        { label: 'Update Workflow Metadata', id: 'update_workflow_metadata' },
        { label: 'Cancel Workflow', id: 'cancel_workflow' },
        { label: 'List Workflow Approvals', id: 'list_workflow_approvals' },
        { label: 'Add Comment', id: 'add_comment' },
        { label: 'List Workflow Comments', id: 'list_workflow_comments' },
        { label: 'Create Record', id: 'create_record' },
        { label: 'List Records', id: 'list_records' },
        { label: 'Get Record', id: 'get_record' },
        { label: 'Update Record', id: 'update_record' },
      ],
      value: () => 'list_workflows',
    },
    {
      id: 'credential',
      title: 'Ironclad Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'ironclad',
      requiredScopes: getScopesForService('ironclad'),
      placeholder: 'Select Ironclad account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Ironclad Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    // Create Workflow fields
    {
      id: 'template',
      title: 'Template ID',
      type: 'short-input',
      placeholder: 'Enter workflow template ID',
      condition: { field: 'operation', value: 'create_workflow' },
      required: { field: 'operation', value: 'create_workflow' },
    },
    {
      id: 'attributes',
      title: 'Attributes',
      type: 'long-input',
      placeholder: '{"counterpartyName": "Acme Corp"}',
      condition: { field: 'operation', value: 'create_workflow' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of Ironclad workflow attributes based on the description. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the workflow attributes...',
        generationType: 'json-object',
      },
    },

    // Workflow ID field (shared by get, update metadata, cancel, approvals, comments)
    {
      id: 'workflowId',
      title: 'Workflow ID',
      type: 'short-input',
      placeholder: 'Enter workflow ID',
      condition: {
        field: 'operation',
        value: [
          'get_workflow',
          'update_workflow_metadata',
          'cancel_workflow',
          'list_workflow_approvals',
          'add_comment',
          'list_workflow_comments',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_workflow',
          'update_workflow_metadata',
          'cancel_workflow',
          'list_workflow_approvals',
          'add_comment',
          'list_workflow_comments',
        ],
      },
    },

    // Update Workflow Metadata fields
    {
      id: 'actions',
      title: 'Actions',
      type: 'long-input',
      placeholder: '[{"action": "set", "field": "status", "value": "Approved"}]',
      condition: { field: 'operation', value: 'update_workflow_metadata' },
      required: { field: 'operation', value: 'update_workflow_metadata' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Ironclad workflow update actions. Each action has "action" ("set" or "remove"), "field" (attribute name), and optionally "value". Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the updates (e.g., "set status to Approved")...',
        generationType: 'json-object',
      },
    },

    // Add Comment field
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Enter comment text',
      condition: { field: 'operation', value: 'add_comment' },
      required: { field: 'operation', value: 'add_comment' },
    },

    // Create Record fields
    {
      id: 'recordType',
      title: 'Record Type',
      type: 'short-input',
      placeholder: 'e.g., contract, Statement of Work',
      condition: { field: 'operation', value: 'create_record' },
      required: { field: 'operation', value: 'create_record' },
    },
    {
      id: 'name',
      title: 'Record Name',
      type: 'short-input',
      placeholder: 'Enter record name',
      condition: { field: 'operation', value: 'create_record' },
      required: { field: 'operation', value: 'create_record' },
    },
    {
      id: 'properties',
      title: 'Properties',
      type: 'long-input',
      placeholder: '{"counterpartyName": {"type": "string", "value": "Acme Corp"}}',
      condition: { field: 'operation', value: ['create_record', 'update_record'] },
      required: { field: 'operation', value: 'update_record' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of Ironclad record properties. Each property has a "type" (string/number/email/date/monetary_amount) and "value". Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the record properties...',
        generationType: 'json-object',
      },
    },
    {
      id: 'links',
      title: 'Linked Records',
      type: 'long-input',
      placeholder: '[{"recordId": "abc-123"}]',
      condition: { field: 'operation', value: 'create_record' },
      mode: 'advanced',
    },

    // Get/Update Record fields
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'Enter record ID',
      condition: { field: 'operation', value: ['get_record', 'update_record'] },
      required: { field: 'operation', value: ['get_record', 'update_record'] },
    },

    // List pagination fields
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: ['list_workflows', 'list_records'] },
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: ['list_workflows', 'list_records'] },
      mode: 'advanced',
    },
    {
      id: 'lastUpdated',
      title: 'Last Updated After',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'list_records' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp based on the description. Return ONLY the timestamp string - no explanations, no extra text.',
        placeholder: 'Describe the date (e.g., "yesterday", "last week")...',
        generationType: 'timestamp',
      },
    },
  ],
  tools: {
    access: [
      'ironclad_create_workflow',
      'ironclad_list_workflows',
      'ironclad_get_workflow',
      'ironclad_update_workflow_metadata',
      'ironclad_cancel_workflow',
      'ironclad_list_workflow_approvals',
      'ironclad_add_comment',
      'ironclad_list_workflow_comments',
      'ironclad_create_record',
      'ironclad_list_records',
      'ironclad_get_record',
      'ironclad_update_record',
    ],
    config: {
      tool: (params) => `ironclad_${params.operation}`,
      params: (params) => {
        const { oauthCredential, ...rest } = params
        const result: Record<string, unknown> = {
          credential: oauthCredential,
          ...rest,
        }
        if (result.workflowId !== undefined) {
          result.ironcladWorkflowId = result.workflowId
          result.workflowId = undefined
        }
        if (params.page !== undefined) result.page = Number(params.page)
        if (params.pageSize !== undefined && params.pageSize !== '') {
          if (params.operation === 'list_workflows') {
            result.perPage = Number(params.pageSize)
            result.pageSize = undefined
          } else {
            result.pageSize = Number(params.pageSize)
          }
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Ironclad OAuth credential' },
    template: { type: 'string', description: 'Workflow template ID' },
    attributes: { type: 'string', description: 'Workflow attributes (JSON)' },
    workflowId: { type: 'string', description: 'Workflow ID' },
    actions: { type: 'string', description: 'Update actions (JSON array)' },
    comment: { type: 'string', description: 'Comment text' },
    recordType: { type: 'string', description: 'Record type' },
    name: { type: 'string', description: 'Record name' },
    properties: { type: 'string', description: 'Record properties (JSON)' },
    links: { type: 'string', description: 'Linked records (JSON array)' },
    recordId: { type: 'string', description: 'Record ID' },
    page: { type: 'number', description: 'Page number' },
    pageSize: { type: 'number', description: 'Results per page' },
    lastUpdated: { type: 'string', description: 'Filter by last updated timestamp' },
  },
  outputs: {
    // Workflow outputs
    id: { type: 'string', description: 'Resource ID' },
    status: { type: 'string', description: 'Workflow status' },
    template: { type: 'string', description: 'Workflow template' },
    creator: { type: 'string', description: 'Workflow creator' },
    step: { type: 'string', description: 'Current workflow step' },
    attributes: { type: 'json', description: 'Workflow attributes' },
    approvals: { type: 'json', description: 'Workflow approval groups' },
    comments: { type: 'json', description: 'Workflow comments' },
    // Record outputs
    name: { type: 'string', description: 'Record name' },
    type: { type: 'string', description: 'Record type' },
    properties: { type: 'json', description: 'Record properties' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    // List outputs
    workflows: { type: 'json', description: 'List of workflows' },
    records: { type: 'json', description: 'List of records' },
    page: { type: 'number', description: 'Current page number' },
    pageSize: { type: 'number', description: 'Results per page' },
    count: { type: 'number', description: 'Total count' },
    // Action outputs
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
  },
}
