import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { OracleEpmEdmResponse } from '@/tools/oracle_epm_enterprise_data_management/types'

const OPERATION_FIELDS: Record<string, readonly string[]> = {
  oracle_epm_edm_list_applications: ['applicationId', 'permission', 'maxResults'],
  oracle_epm_edm_list_dimensions: ['applicationId', 'maxResults'],
  oracle_epm_edm_list_views: ['dimensionId', 'objectStatus', 'maxResults'],
  oracle_epm_edm_list_viewpoints: ['viewId', 'dimensionId', 'applicationId', 'maxResults'],
  oracle_epm_edm_list_node_types: ['viewId', 'viewpointId', 'maxResults'],
  oracle_epm_edm_get_node_type: ['viewId', 'viewpointId', 'nodeTypeId'],
  oracle_epm_edm_list_nodes: [
    'viewId',
    'viewpointId',
    'scope',
    'parentNodeId',
    'requestId',
    'expand',
    'limit',
    'offset',
    'fromId',
    'toId',
    'orderBy',
  ],
  oracle_epm_edm_get_node: ['viewId', 'viewpointId', 'nodeId', 'requestId', 'expand'],
  oracle_epm_edm_get_node_at_location: [
    'viewId',
    'viewpointId',
    'nodeId',
    'location',
    'requestId',
    'expand',
  ],
  oracle_epm_edm_browse_hierarchy: [
    'viewId',
    'viewpointId',
    'maxDepth',
    'maxNodes',
    'pageSize',
    'maxRequests',
  ],
  oracle_epm_edm_create_request: [
    'viewId',
    'title',
    'description',
    'notes',
    'priority',
    'timeLabelName',
  ],
  oracle_epm_edm_get_request: ['requestId'],
  oracle_epm_edm_query_requests: [
    'lastDays',
    'fromDate',
    'toDate',
    'myActivity',
    'owner',
    'queryPriority',
    'requestNumber',
    'requestType',
    'stage',
    'status',
    'timeLabelName',
    'viewName',
    'expandWorkflow',
    'maxResults',
  ],
  oracle_epm_edm_get_request_lineage: ['requestId'],
  oracle_epm_edm_assign_request: ['requestNumber', 'userName', 'comment'],
  oracle_epm_edm_delete_request: ['requestId'],
  oracle_epm_edm_upload_request_attachment: ['requestId', 'file', 'fileName'],
  oracle_epm_edm_generate_request_attachment: [
    'requestId',
    'fileName',
    'items',
    'overwrite',
    'waitForCompletion',
    'maxWaitSeconds',
  ],
  oracle_epm_edm_import_request_attachment: [
    'requestId',
    'attachmentId',
    'sheetNames',
    'waitForCompletion',
    'maxWaitSeconds',
  ],
  oracle_epm_edm_transition_request: [
    'requestId',
    'action',
    'comment',
    'transitionWithWarning',
    'waitForCompletion',
    'maxWaitSeconds',
  ],
  oracle_epm_edm_get_job_status: ['jobRunId'],
  oracle_epm_edm_get_job_result: ['jobRunId', 'downloadFile', 'fileName'],
  oracle_epm_edm_validate_viewpoint: [
    'viewName',
    'viewpointName',
    'fileName',
    'requestNumber',
    'waitForCompletion',
    'maxWaitSeconds',
  ],
  oracle_epm_edm_get_mapping_keys: ['dimensionId', 'bindingId'],
  oracle_epm_edm_export_mappings: [
    'applicationName',
    'dimensionName',
    'fileName',
    'mappingLocation',
    'connection',
    'waitForCompletion',
    'maxWaitSeconds',
  ],
  oracle_epm_edm_import_dimension: [
    'applicationName',
    'dimensionName',
    'fileName',
    'importOption',
    'file',
    'connection',
    'waitForCompletion',
    'maxWaitSeconds',
  ],
  oracle_epm_edm_load_viewpoint: [
    'viewName',
    'viewpointName',
    'fileName',
    'purpose',
    'loadOption',
    'file',
    'waitForCompletion',
    'maxWaitSeconds',
  ],
  oracle_epm_edm_export_dimension: [
    'applicationName',
    'dimensionName',
    'fileName',
    'connection',
    'waitForCompletion',
    'maxWaitSeconds',
  ],
  oracle_epm_edm_incremental_export_dimension: [
    'applicationName',
    'dimensionName',
    'fileName',
    'bindingNames',
    'nodeChangeTypes',
    'since',
    'sinceLastExportOfType',
    'connectionName',
    'waitForCompletion',
    'maxWaitSeconds',
  ],
  oracle_epm_edm_extract_dimension_viewpoint: [
    'applicationName',
    'dimensionName',
    'fileName',
    'extractName',
    'connection',
    'fromTime',
    'toTime',
    'requestNumber',
    'waitForCompletion',
    'maxWaitSeconds',
  ],
}
const FIELD_KINDS: Record<string, string> = {
  applicationId: 'string',
  permission: 'string',
  maxResults: 'number',
  dimensionId: 'string',
  objectStatus: 'string',
  viewId: 'string',
  viewpointId: 'string',
  nodeTypeId: 'string',
  scope: 'string',
  parentNodeId: 'string',
  requestId: 'string',
  expand: 'string',
  limit: 'number',
  offset: 'number',
  fromId: 'string',
  toId: 'string',
  orderBy: 'string',
  nodeId: 'string',
  location: 'string',
  maxDepth: 'number',
  maxNodes: 'number',
  pageSize: 'number',
  maxRequests: 'number',
  title: 'string',
  description: 'string',
  notes: 'string',
  priority: 'string',
  queryPriority: 'string',
  timeLabelName: 'string',
  lastDays: 'number',
  fromDate: 'number',
  toDate: 'number',
  myActivity: 'string',
  owner: 'string',
  requestNumber: 'number',
  requestType: 'string',
  stage: 'string',
  status: 'string',
  viewName: 'string',
  expandWorkflow: 'boolean',
  userName: 'string',
  comment: 'string',
  file: 'file',
  fileName: 'string',
  items: 'array',
  overwrite: 'boolean',
  waitForCompletion: 'boolean',
  maxWaitSeconds: 'number',
  attachmentId: 'string',
  sheetNames: 'array',
  action: 'string',
  transitionWithWarning: 'boolean',
  jobRunId: 'string',
  downloadFile: 'boolean',
  viewpointName: 'string',
  bindingId: 'string',
  applicationName: 'string',
  dimensionName: 'string',
  mappingLocation: 'string',
  connection: 'string',
  importOption: 'string',
  purpose: 'string',
  loadOption: 'string',
  bindingNames: 'array',
  nodeChangeTypes: 'array',
  since: 'number',
  sinceLastExportOfType: 'string',
  connectionName: 'string',
  extractName: 'string',
  fromTime: 'string',
  toTime: 'string',
}

const REQUEST_ID_OPERATIONS = [
  'oracle_epm_edm_get_node',
  'oracle_epm_edm_get_node_at_location',
  'oracle_epm_edm_get_request',
  'oracle_epm_edm_get_request_lineage',
  'oracle_epm_edm_delete_request',
  'oracle_epm_edm_upload_request_attachment',
  'oracle_epm_edm_generate_request_attachment',
  'oracle_epm_edm_import_request_attachment',
  'oracle_epm_edm_transition_request',
]
const REQUIRED_REQUEST_ID_OPERATIONS = [
  'oracle_epm_edm_get_request',
  'oracle_epm_edm_get_request_lineage',
  'oracle_epm_edm_delete_request',
  'oracle_epm_edm_upload_request_attachment',
  'oracle_epm_edm_generate_request_attachment',
  'oracle_epm_edm_import_request_attachment',
  'oracle_epm_edm_transition_request',
]

function requestIdCondition(values: Record<string, unknown> | undefined, required: boolean) {
  return {
    field: 'operation',
    value: [
      ...(required ? REQUIRED_REQUEST_ID_OPERATIONS : REQUEST_ID_OPERATIONS),
      ...(values?.scope === 'request' ? ['oracle_epm_edm_list_nodes'] : []),
    ],
  }
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  if (value === undefined || value === null || value === '') return undefined
  throw new Error('Expected Yes or No for an EDM boolean input')
}

/** Only the selected operation's fields reach the tool; stale editor values are excluded. */
function operationParams(params: Record<string, unknown>): Record<string, unknown> {
  const operation = typeof params.operation === 'string' ? params.operation : ''
  const selectedFields = OPERATION_FIELDS[operation]
  if (!selectedFields) throw new Error('Select a supported Oracle EDM operation')
  const output: Record<string, unknown> = { oauthCredential: params.oauthCredential }
  for (const field of selectedFields) {
    const value = params[field]
    if (value === undefined || value === null || value === '') continue
    const key = field === 'queryPriority' ? 'priority' : field
    switch (FIELD_KINDS[field]) {
      case 'number':
        output[key] = parseOptionalNumberInput(value, field, { integer: true })
        break
      case 'boolean':
        output[key] = optionalBoolean(value)
        break
      case 'array':
        if (typeof value === 'string') {
          try {
            output[key] = JSON.parse(value)
          } catch {
            throw new Error(`${field} must be valid JSON`)
          }
        } else output[key] = value
        break
      case 'file':
        output[key] = normalizeFileInput(value, { single: true })
        break
      default:
        output[key] = value
    }
  }
  // The application picker scopes the dimension picker; Oracle receives only one filter.
  if (operation === 'oracle_epm_edm_list_viewpoints' && output.dimensionId)
    output.applicationId = undefined
  if (operation === 'oracle_epm_edm_list_nodes') {
    if (output.scope !== 'children') output.parentNodeId = undefined
    if (output.scope !== 'request') output.requestId = undefined
  }
  return output
}

export const OracleEpmEnterpriseDataManagementBlock: BlockConfig<OracleEpmEdmResponse> = {
  type: 'oracle_epm_enterprise_data_management',
  name: 'Oracle EPM Enterprise Data Management',
  description:
    'Manage dimensions, viewpoints, nodes, governed requests, validation, and data transfers',
  longDescription:
    'Use a reusable Oracle EPM service account to discover enterprise master data, browse bounded hierarchies, prepare and transition governed requests, inspect subscription-generated request lineage, run validation, and import or export files. Node changes flow through request attachments. Subscription and validation-definition administration are not included. Upload-to-import request workflows are supported; generated attachment jobs return opaque results because Oracle does not document the generated attachment ID needed to chain an import automatically. Oracle job COMPLETED is not a guarantee of business success: inspect job results and validation reports.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_epm_enterprise_data_management',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle EDM',
    sentences: {
      byOperation: {
        oracle_epm_edm_list_applications: ['List Applications'],
        oracle_epm_edm_list_dimensions: [
          {
            text: 'List dimensions in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        oracle_epm_edm_list_views: ['List Views'],
        oracle_epm_edm_list_viewpoints: [
          { text: 'List viewpoints in', field: ['viewSelector', 'viewManual'], core: true },
        ],
        oracle_epm_edm_list_node_types: [
          {
            text: 'List node types in',
            field: ['viewpointSelector', 'viewpointManual'],
            core: true,
          },
        ],
        oracle_epm_edm_get_node_type: [
          { text: 'Get node type', field: ['nodeTypeSelector', 'nodeTypeManual'], core: true },
        ],
        oracle_epm_edm_list_nodes: [
          { text: 'List nodes in', field: ['viewpointSelector', 'viewpointManual'], core: true },
        ],
        oracle_epm_edm_get_node: [{ text: 'Get node', field: 'nodeId', core: true }],
        oracle_epm_edm_get_node_at_location: [
          { text: 'Get node at location for', field: 'nodeId', core: true },
        ],
        oracle_epm_edm_browse_hierarchy: [
          {
            text: 'Browse hierarchy in',
            field: ['viewpointSelector', 'viewpointManual'],
            core: true,
          },
        ],
        oracle_epm_edm_create_request: [
          { text: 'Create request in', field: ['viewSelector', 'viewManual'], core: true },
        ],
        oracle_epm_edm_get_request: [
          { text: 'Get request', field: ['requestSelector', 'requestManual'], core: true },
        ],
        oracle_epm_edm_query_requests: ['Query Requests'],
        oracle_epm_edm_get_request_lineage: [
          { text: 'Inspect lineage for', field: ['requestSelector', 'requestManual'], core: true },
        ],
        oracle_epm_edm_assign_request: [
          { text: 'Assign request', field: 'requestNumber', core: true },
        ],
        oracle_epm_edm_delete_request: [
          { text: 'Delete request', field: ['requestSelector', 'requestManual'], core: true },
        ],
        oracle_epm_edm_upload_request_attachment: [
          { text: 'Upload attachment to', field: ['requestSelector', 'requestManual'], core: true },
        ],
        oracle_epm_edm_generate_request_attachment: [
          {
            text: 'Generate attachment for',
            field: ['requestSelector', 'requestManual'],
            core: true,
          },
        ],
        oracle_epm_edm_import_request_attachment: [
          {
            text: 'Import attachment into',
            field: ['requestSelector', 'requestManual'],
            core: true,
          },
        ],
        oracle_epm_edm_transition_request: [
          { text: 'Transition request', field: ['requestSelector', 'requestManual'], core: true },
        ],
        oracle_epm_edm_get_job_status: [{ text: 'Check job', field: 'jobRunId', core: true }],
        oracle_epm_edm_get_job_result: [
          { text: 'Get result for job', field: 'jobRunId', core: true },
        ],
        oracle_epm_edm_validate_viewpoint: [
          { text: 'Validate viewpoint', field: 'viewpointName', core: true },
        ],
        oracle_epm_edm_get_mapping_keys: [
          { text: 'Get mapping keys for binding', field: 'bindingId', core: true },
        ],
        oracle_epm_edm_export_mappings: [
          { text: 'Export mappings from', field: 'dimensionName', core: true },
        ],
        oracle_epm_edm_import_dimension: [
          { text: 'Import dimension', field: 'dimensionName', core: true },
        ],
        oracle_epm_edm_load_viewpoint: [
          { text: 'Load viewpoint', field: 'viewpointName', core: true },
        ],
        oracle_epm_edm_export_dimension: [
          { text: 'Export dimension', field: 'dimensionName', core: true },
        ],
        oracle_epm_edm_incremental_export_dimension: [
          { text: 'Incrementally export dimension', field: 'dimensionName', core: true },
        ],
        oracle_epm_edm_extract_dimension_viewpoint: [
          { text: 'Run extract', field: 'extractName', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'Oracle EPM Account',
      type: 'oauth-input',
      serviceId: 'oracle-epm-enterprise-data-management',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Oracle EPM credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Oracle EPM Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Applications', id: 'oracle_epm_edm_list_applications' },
        { label: 'List Dimensions', id: 'oracle_epm_edm_list_dimensions' },
        { label: 'List Views', id: 'oracle_epm_edm_list_views' },
        { label: 'List Viewpoints', id: 'oracle_epm_edm_list_viewpoints' },
        { label: 'List Node Types', id: 'oracle_epm_edm_list_node_types' },
        { label: 'Get Node Type', id: 'oracle_epm_edm_get_node_type' },
        { label: 'List Nodes', id: 'oracle_epm_edm_list_nodes' },
        { label: 'Get Node', id: 'oracle_epm_edm_get_node' },
        { label: 'Get Node At Location', id: 'oracle_epm_edm_get_node_at_location' },
        { label: 'Browse Hierarchy', id: 'oracle_epm_edm_browse_hierarchy' },
        { label: 'Create Request', id: 'oracle_epm_edm_create_request' },
        { label: 'Get Request', id: 'oracle_epm_edm_get_request' },
        { label: 'Query Requests', id: 'oracle_epm_edm_query_requests' },
        { label: 'Get Request Lineage', id: 'oracle_epm_edm_get_request_lineage' },
        { label: 'Assign Request', id: 'oracle_epm_edm_assign_request' },
        { label: 'Delete Request', id: 'oracle_epm_edm_delete_request' },
        { label: 'Upload Request Attachment', id: 'oracle_epm_edm_upload_request_attachment' },
        { label: 'Generate Request Attachment', id: 'oracle_epm_edm_generate_request_attachment' },
        { label: 'Import Request Attachment', id: 'oracle_epm_edm_import_request_attachment' },
        { label: 'Transition Request', id: 'oracle_epm_edm_transition_request' },
        { label: 'Get Job Status', id: 'oracle_epm_edm_get_job_status' },
        { label: 'Get Job Result', id: 'oracle_epm_edm_get_job_result' },
        { label: 'Validate Viewpoint', id: 'oracle_epm_edm_validate_viewpoint' },
        { label: 'Get Mapping Keys', id: 'oracle_epm_edm_get_mapping_keys' },
        { label: 'Export Mappings', id: 'oracle_epm_edm_export_mappings' },
        { label: 'Import Dimension', id: 'oracle_epm_edm_import_dimension' },
        { label: 'Load Viewpoint', id: 'oracle_epm_edm_load_viewpoint' },
        { label: 'Export Dimension', id: 'oracle_epm_edm_export_dimension' },
        {
          label: 'Incremental Export Dimension',
          id: 'oracle_epm_edm_incremental_export_dimension',
        },
        { label: 'Extract Dimension Viewpoint', id: 'oracle_epm_edm_extract_dimension_viewpoint' },
      ],
      value: () => 'oracle_epm_edm_list_applications',
      required: true,
    },
    {
      id: 'applicationSelector',
      title: 'Application ID',
      type: 'project-selector',
      description:
        'Application UUID. Choices are locally filtered within at most 500 returned results.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_applications',
          'oracle_epm_edm_list_dimensions',
          'oracle_epm_edm_list_viewpoints',
          'oracle_epm_edm_list_views',
          'oracle_epm_edm_get_mapping_keys',
        ],
      },
      required: { field: 'operation', value: ['oracle_epm_edm_list_dimensions'] },
      canonicalParamId: 'applicationId',
      serviceId: 'oracle-epm-enterprise-data-management',
      selectorKey: 'oracleEpmEdm.applications',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select application',
    },
    {
      id: 'applicationManual',
      title: 'Application ID',
      type: 'short-input',
      description: 'Application UUID',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_applications',
          'oracle_epm_edm_list_dimensions',
          'oracle_epm_edm_list_viewpoints',
          'oracle_epm_edm_list_views',
          'oracle_epm_edm_get_mapping_keys',
        ],
      },
      required: { field: 'operation', value: ['oracle_epm_edm_list_dimensions'] },
      canonicalParamId: 'applicationId',
      mode: 'advanced',
      placeholder: 'Enter Application UUID',
    },
    {
      id: 'permission',
      title: 'Permission',
      type: 'dropdown',
      description:
        'One application permission: owner, datamanager, participant, or participant_with_write',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_applications'] },
      options: [
        { label: 'owner', id: 'owner' },
        { label: 'datamanager', id: 'datamanager' },
        { label: 'participant', id: 'participant' },
        { label: 'participant_with_write', id: 'participant_with_write' },
      ],
      mode: 'advanced',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      description:
        'Maximum projected items (1-500; default 200). This is a local result cap, not provider pagination.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_applications',
          'oracle_epm_edm_list_dimensions',
          'oracle_epm_edm_list_views',
          'oracle_epm_edm_list_viewpoints',
          'oracle_epm_edm_list_node_types',
          'oracle_epm_edm_query_requests',
        ],
      },
      placeholder:
        'Maximum projected items (1-500; default 200). This is a local result cap, not provider pagination.',
      mode: 'advanced',
    },
    {
      id: 'dimensionSelector',
      title: 'Dimension ID',
      type: 'project-selector',
      description:
        'Dimension UUID. Choices are locally filtered within at most 500 returned results.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_views',
          'oracle_epm_edm_list_viewpoints',
          'oracle_epm_edm_get_mapping_keys',
        ],
      },
      required: { field: 'operation', value: ['oracle_epm_edm_get_mapping_keys'] },
      canonicalParamId: 'dimensionId',
      serviceId: 'oracle-epm-enterprise-data-management',
      selectorKey: 'oracleEpmEdm.dimensions',
      dependsOn: ['credential', 'applicationId'],
      mode: 'basic',
      placeholder: 'Select dimension',
    },
    {
      id: 'dimensionManual',
      title: 'Dimension ID',
      type: 'short-input',
      description: 'Dimension UUID',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_views',
          'oracle_epm_edm_list_viewpoints',
          'oracle_epm_edm_get_mapping_keys',
        ],
      },
      required: { field: 'operation', value: ['oracle_epm_edm_get_mapping_keys'] },
      canonicalParamId: 'dimensionId',
      mode: 'advanced',
      placeholder: 'Enter Dimension UUID',
    },
    {
      id: 'objectStatus',
      title: 'Object Status',
      type: 'dropdown',
      description: 'One view status filter',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_views'] },
      options: [
        { label: 'DRAFT', id: 'DRAFT' },
        { label: 'ACTIVE', id: 'ACTIVE' },
        { label: 'ARCHIVED', id: 'ARCHIVED' },
      ],
      mode: 'advanced',
    },
    {
      id: 'viewSelector',
      title: 'View ID',
      type: 'project-selector',
      description: 'View UUID. Choices are locally filtered within at most 500 returned results.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_viewpoints',
          'oracle_epm_edm_list_node_types',
          'oracle_epm_edm_get_node_type',
          'oracle_epm_edm_list_nodes',
          'oracle_epm_edm_get_node',
          'oracle_epm_edm_get_node_at_location',
          'oracle_epm_edm_browse_hierarchy',
          'oracle_epm_edm_create_request',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_viewpoints',
          'oracle_epm_edm_list_node_types',
          'oracle_epm_edm_get_node_type',
          'oracle_epm_edm_list_nodes',
          'oracle_epm_edm_get_node',
          'oracle_epm_edm_get_node_at_location',
          'oracle_epm_edm_browse_hierarchy',
          'oracle_epm_edm_create_request',
        ],
      },
      canonicalParamId: 'viewId',
      serviceId: 'oracle-epm-enterprise-data-management',
      selectorKey: 'oracleEpmEdm.views',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select view',
    },
    {
      id: 'viewManual',
      title: 'View ID',
      type: 'short-input',
      description: 'View UUID',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_viewpoints',
          'oracle_epm_edm_list_node_types',
          'oracle_epm_edm_get_node_type',
          'oracle_epm_edm_list_nodes',
          'oracle_epm_edm_get_node',
          'oracle_epm_edm_get_node_at_location',
          'oracle_epm_edm_browse_hierarchy',
          'oracle_epm_edm_create_request',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_viewpoints',
          'oracle_epm_edm_list_node_types',
          'oracle_epm_edm_get_node_type',
          'oracle_epm_edm_list_nodes',
          'oracle_epm_edm_get_node',
          'oracle_epm_edm_get_node_at_location',
          'oracle_epm_edm_browse_hierarchy',
          'oracle_epm_edm_create_request',
        ],
      },
      canonicalParamId: 'viewId',
      mode: 'advanced',
      placeholder: 'Enter View UUID',
    },
    {
      id: 'viewpointSelector',
      title: 'Viewpoint ID',
      type: 'project-selector',
      description:
        'Viewpoint UUID. Choices are locally filtered within at most 500 returned results.',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_node_types',
          'oracle_epm_edm_get_node_type',
          'oracle_epm_edm_list_nodes',
          'oracle_epm_edm_get_node',
          'oracle_epm_edm_get_node_at_location',
          'oracle_epm_edm_browse_hierarchy',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_node_types',
          'oracle_epm_edm_get_node_type',
          'oracle_epm_edm_list_nodes',
          'oracle_epm_edm_get_node',
          'oracle_epm_edm_get_node_at_location',
          'oracle_epm_edm_browse_hierarchy',
        ],
      },
      canonicalParamId: 'viewpointId',
      serviceId: 'oracle-epm-enterprise-data-management',
      selectorKey: 'oracleEpmEdm.viewpoints',
      dependsOn: ['credential', 'viewId'],
      mode: 'basic',
      placeholder: 'Select viewpoint',
    },
    {
      id: 'viewpointManual',
      title: 'Viewpoint ID',
      type: 'short-input',
      description: 'Viewpoint UUID',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_node_types',
          'oracle_epm_edm_get_node_type',
          'oracle_epm_edm_list_nodes',
          'oracle_epm_edm_get_node',
          'oracle_epm_edm_get_node_at_location',
          'oracle_epm_edm_browse_hierarchy',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_node_types',
          'oracle_epm_edm_get_node_type',
          'oracle_epm_edm_list_nodes',
          'oracle_epm_edm_get_node',
          'oracle_epm_edm_get_node_at_location',
          'oracle_epm_edm_browse_hierarchy',
        ],
      },
      canonicalParamId: 'viewpointId',
      mode: 'advanced',
      placeholder: 'Enter Viewpoint UUID',
    },
    {
      id: 'nodeTypeSelector',
      title: 'Node Type ID',
      type: 'project-selector',
      description:
        'Node-type UUID assigned to the selected viewpoint. Choices are locally filtered within at most 500 returned results.',
      condition: { field: 'operation', value: ['oracle_epm_edm_get_node_type'] },
      required: { field: 'operation', value: ['oracle_epm_edm_get_node_type'] },
      canonicalParamId: 'nodeTypeId',
      serviceId: 'oracle-epm-enterprise-data-management',
      selectorKey: 'oracleEpmEdm.nodeTypes',
      dependsOn: ['credential', 'viewId', 'viewpointId'],
      mode: 'basic',
      placeholder: 'Select node type',
    },
    {
      id: 'nodeTypeManual',
      title: 'Node Type ID',
      type: 'short-input',
      description: 'Node-type UUID assigned to the selected viewpoint',
      condition: { field: 'operation', value: ['oracle_epm_edm_get_node_type'] },
      required: { field: 'operation', value: ['oracle_epm_edm_get_node_type'] },
      canonicalParamId: 'nodeTypeId',
      mode: 'advanced',
      placeholder: 'Enter Node-type UUID assigned to the selected viewpoint',
    },
    {
      id: 'scope',
      title: 'Scope',
      type: 'dropdown',
      description:
        'Node listing scope (default top); children requires parentNodeId, request requires requestId',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_nodes'] },
      options: [
        { label: 'top', id: 'top' },
        { label: 'all', id: 'all' },
        { label: 'children', id: 'children' },
        { label: 'request', id: 'request' },
      ],
      value: () => 'top',
    },
    {
      id: 'parentNodeId',
      title: 'Parent Node ID',
      type: 'short-input',
      description: 'Parent node UUID for children scope only',
      condition: {
        field: 'operation',
        value: 'oracle_epm_edm_list_nodes',
        and: { field: 'scope', value: 'children' },
      },
      placeholder: 'Parent node UUID for children scope only',
      required: true,
    },
    {
      id: 'requestSelector',
      title: 'Request ID',
      type: 'project-selector',
      description:
        'Request UUID; for node listing it requires request scope. Choices are locally filtered within at most 500 returned results.',
      condition: (values) => requestIdCondition(values, false),
      required: (values) => requestIdCondition(values, true),
      canonicalParamId: 'requestId',
      serviceId: 'oracle-epm-enterprise-data-management',
      selectorKey: 'oracleEpmEdm.requests',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select request',
    },
    {
      id: 'requestManual',
      title: 'Request ID',
      type: 'short-input',
      description: 'Request UUID; for node listing it requires request scope',
      condition: (values) => requestIdCondition(values, false),
      required: (values) => requestIdCondition(values, true),
      canonicalParamId: 'requestId',
      mode: 'advanced',
      placeholder: 'Enter Request UUID; for node listing it requires request scope',
    },
    {
      id: 'expand',
      title: 'Expand',
      type: 'dropdown',
      description: 'One documented node expansion',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_list_nodes',
          'oracle_epm_edm_get_node',
          'oracle_epm_edm_get_node_at_location',
        ],
      },
      options: [
        { label: 'propertyValues::none', id: 'propertyValues::none' },
        { label: 'propertyValues::all', id: 'propertyValues::all' },
        { label: 'propertyValues::columnVisible', id: 'propertyValues::columnVisible' },
        { label: 'propertyValues::locationVisible', id: 'propertyValues::locationVisible' },
        { label: 'requestItem.validations', id: 'requestItem.validations' },
        { label: 'bestLocationRtl', id: 'bestLocationRtl' },
      ],
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      description: 'Node page size (1-100; default 50)',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_nodes'] },
      placeholder: 'Node page size (1-100; default 50)',
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      description: 'Node page offset (0-1000000; default 0)',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_nodes'] },
      placeholder: 'Node page offset (0-1000000; default 0)',
      mode: 'advanced',
    },
    {
      id: 'fromId',
      title: 'From ID',
      type: 'short-input',
      description:
        'Nodes after this node UUID; append * to include it, or use first. Cannot combine with toId.',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_nodes'] },
      placeholder:
        'Nodes after this node UUID; append * to include it, or use first. Cannot combine with toId.',
      mode: 'advanced',
    },
    {
      id: 'toId',
      title: 'To ID',
      type: 'short-input',
      description:
        'Nodes before this node UUID; append * to include it, or use last. Cannot combine with fromId.',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_nodes'] },
      placeholder:
        'Nodes before this node UUID; append * to include it, or use last. Cannot combine with fromId.',
      mode: 'advanced',
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'dropdown',
      description: 'Hierarchy-set node order',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_nodes'] },
      options: [
        { label: 'hsConfig:asc', id: 'hsConfig:asc' },
        { label: 'hsConfig:desc', id: 'hsConfig:desc' },
      ],
      mode: 'advanced',
    },
    {
      id: 'nodeId',
      title: 'Node ID',
      type: 'short-input',
      description: 'Node UUID',
      condition: {
        field: 'operation',
        value: ['oracle_epm_edm_get_node', 'oracle_epm_edm_get_node_at_location'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_edm_get_node', 'oracle_epm_edm_get_node_at_location'],
      },
      placeholder: 'Node UUID',
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      description: 'Comma-separated ancestor/node UUIDs, root first (maximum 255 characters)',
      condition: { field: 'operation', value: ['oracle_epm_edm_get_node_at_location'] },
      required: { field: 'operation', value: ['oracle_epm_edm_get_node_at_location'] },
      placeholder: 'Comma-separated ancestor/node UUIDs, root first (maximum 255 characters)',
      wandConfig: {
        enabled: true,
        prompt:
          'Format only the supplied ancestor and node UUIDs in root-first order, separated by commas. Do not invent missing IDs. Return ONLY the comma-separated UUID list.',
        placeholder: 'Paste node UUIDs in root-first order...',
      },
    },
    {
      id: 'maxDepth',
      title: 'Max Depth',
      type: 'short-input',
      description: 'Maximum traversal depth (0-3; default 2); roots have depth zero',
      condition: { field: 'operation', value: ['oracle_epm_edm_browse_hierarchy'] },
      placeholder: 'Maximum traversal depth (0-3; default 2); roots have depth zero',
      mode: 'advanced',
    },
    {
      id: 'maxNodes',
      title: 'Max Nodes',
      type: 'short-input',
      description: 'Maximum hierarchy occurrences (1-500; default 200)',
      condition: { field: 'operation', value: ['oracle_epm_edm_browse_hierarchy'] },
      placeholder: 'Maximum hierarchy occurrences (1-500; default 200)',
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      description: 'Hierarchy provider page size (1-100; default 50)',
      condition: { field: 'operation', value: ['oracle_epm_edm_browse_hierarchy'] },
      placeholder: 'Hierarchy provider page size (1-100; default 50)',
      mode: 'advanced',
    },
    {
      id: 'maxRequests',
      title: 'Max Requests',
      type: 'short-input',
      description: 'Maximum hierarchy provider requests (1-100; default 50)',
      condition: { field: 'operation', value: ['oracle_epm_edm_browse_hierarchy'] },
      placeholder: 'Maximum hierarchy provider requests (1-100; default 50)',
      mode: 'advanced',
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      description: 'Request title',
      condition: { field: 'operation', value: ['oracle_epm_edm_create_request'] },
      placeholder: 'Request title',
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      description: 'Request description',
      condition: { field: 'operation', value: ['oracle_epm_edm_create_request'] },
      placeholder: 'Request description',
      mode: 'advanced',
    },
    {
      id: 'notes',
      title: 'Notes',
      type: 'long-input',
      description: 'Request notes',
      condition: { field: 'operation', value: ['oracle_epm_edm_create_request'] },
      placeholder: 'Request notes',
      mode: 'advanced',
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'dropdown',
      description: 'Priority for a new request',
      condition: { field: 'operation', value: ['oracle_epm_edm_create_request'] },
      options: [
        { label: 'NONE', id: 'NONE' },
        { label: 'LOW', id: 'LOW' },
        { label: 'MEDIUM', id: 'MEDIUM' },
        { label: 'HIGH', id: 'HIGH' },
      ],
      mode: 'advanced',
    },
    {
      id: 'queryPriority',
      title: 'Query Priority',
      type: 'dropdown',
      description: 'One request priority filter',
      condition: { field: 'operation', value: ['oracle_epm_edm_query_requests'] },
      options: [
        { label: 'None', id: 'None' },
        { label: 'Low', id: 'Low' },
        { label: 'Medium', id: 'Medium' },
        { label: 'High', id: 'High' },
      ],
      mode: 'advanced',
    },
    {
      id: 'timeLabelName',
      title: 'Time Label Name',
      type: 'short-input',
      description: 'Time label name; request queries support one value',
      condition: {
        field: 'operation',
        value: ['oracle_epm_edm_create_request', 'oracle_epm_edm_query_requests'],
      },
      placeholder: 'Time label name; request queries support one value',
      mode: 'advanced',
    },
    {
      id: 'lastDays',
      title: 'Last Days',
      type: 'short-input',
      description: 'Previous days to query (1-90; default 30 when no explicit dates are supplied)',
      condition: { field: 'operation', value: ['oracle_epm_edm_query_requests'] },
      placeholder: 'Previous days to query (1-90; default 30 when no explicit dates are supplied)',
    },
    {
      id: 'fromDate',
      title: 'From Date',
      type: 'short-input',
      description:
        'Inclusive start in epoch seconds; provide with toDate, without lastDays, within 90 days',
      condition: { field: 'operation', value: ['oracle_epm_edm_query_requests'] },
      placeholder:
        'Inclusive start in epoch seconds; provide with toDate, without lastDays, within 90 days',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Convert the requested date/time to Unix epoch seconds, not milliseconds. Return ONLY the integer epoch seconds.',
        placeholder: 'Describe the date and time...',
      },
    },
    {
      id: 'toDate',
      title: 'To Date',
      type: 'short-input',
      description: 'End in epoch seconds; provide with fromDate, without lastDays, within 90 days',
      condition: { field: 'operation', value: ['oracle_epm_edm_query_requests'] },
      placeholder: 'End in epoch seconds; provide with fromDate, without lastDays, within 90 days',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Convert the requested date/time to Unix epoch seconds, not milliseconds. Return ONLY the integer epoch seconds.',
        placeholder: 'Describe the date and time...',
      },
    },
    {
      id: 'myActivity',
      title: 'My Activity',
      type: 'dropdown',
      description: 'One activity filter',
      condition: { field: 'operation', value: ['oracle_epm_edm_query_requests'] },
      options: [
        { label: 'Assigned', id: 'Assigned' },
        { label: 'Collaborated', id: 'Collaborated' },
        { label: 'Submitted', id: 'Submitted' },
        { label: 'Invited', id: 'Invited' },
        { label: 'Contributed', id: 'Contributed' },
        { label: 'Managed', id: 'Managed' },
      ],
      mode: 'advanced',
    },
    {
      id: 'owner',
      title: 'Owner',
      type: 'short-input',
      description: 'One request owner name',
      condition: { field: 'operation', value: ['oracle_epm_edm_query_requests'] },
      placeholder: 'One request owner name',
      mode: 'advanced',
    },
    {
      id: 'requestNumber',
      title: 'Request Number',
      type: 'short-input',
      description: 'Positive Oracle request number, not request UUID',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_query_requests',
          'oracle_epm_edm_assign_request',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
      required: { field: 'operation', value: ['oracle_epm_edm_assign_request'] },
      placeholder: 'Positive Oracle request number, not request UUID',
    },
    {
      id: 'requestType',
      title: 'Request Type',
      type: 'dropdown',
      description: 'One request-type filter',
      condition: { field: 'operation', value: ['oracle_epm_edm_query_requests'] },
      options: [
        { label: 'Interactive', id: 'Interactive' },
        { label: 'Subscription', id: 'Subscription' },
        { label: 'Import', id: 'Import' },
        { label: 'Consolidation', id: 'Consolidation' },
      ],
      mode: 'advanced',
    },
    {
      id: 'stage',
      title: 'Stage',
      type: 'dropdown',
      description: 'One request-stage query filter, using Oracle query spelling',
      condition: { field: 'operation', value: ['oracle_epm_edm_query_requests'] },
      options: [
        { label: 'Submit', id: 'Submit' },
        { label: 'Approved', id: 'Approved' },
        { label: 'Commit', id: 'Commit' },
        { label: 'Closed', id: 'Closed' },
      ],
      mode: 'advanced',
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      description: 'One request-status query filter',
      condition: { field: 'operation', value: ['oracle_epm_edm_query_requests'] },
      options: [
        { label: 'Draft', id: 'Draft' },
        { label: 'In Flight', id: 'In Flight' },
        { label: 'Recalled', id: 'Recalled' },
        { label: 'Pushed Back', id: 'Pushed Back' },
        { label: 'Completed', id: 'Completed' },
        { label: 'Rejected', id: 'Rejected' },
        { label: 'Blocked', id: 'Blocked' },
        { label: 'Consolidated', id: 'Consolidated' },
      ],
      mode: 'advanced',
    },
    {
      id: 'viewName',
      title: 'View Name',
      type: 'short-input',
      description: 'View name; request queries accept one value',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_query_requests',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_load_viewpoint',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_edm_validate_viewpoint', 'oracle_epm_edm_load_viewpoint'],
      },
      placeholder: 'View name; request queries accept one value',
    },
    {
      id: 'expandWorkflow',
      title: 'Expand Workflow',
      type: 'switch',
      description: 'Include documented workflow information in request queries',
      condition: { field: 'operation', value: ['oracle_epm_edm_query_requests'] },
      mode: 'advanced',
    },
    {
      id: 'userName',
      title: 'User Name',
      type: 'short-input',
      description: 'Oracle user name to receive the request',
      condition: { field: 'operation', value: ['oracle_epm_edm_assign_request'] },
      required: { field: 'operation', value: ['oracle_epm_edm_assign_request'] },
      placeholder: 'Oracle user name to receive the request',
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      description: 'Workflow or assignment comment',
      condition: {
        field: 'operation',
        value: ['oracle_epm_edm_assign_request', 'oracle_epm_edm_transition_request'],
      },
      placeholder: 'Workflow or assignment comment',
      mode: 'advanced',
    },
    {
      id: 'fileUpload',
      title: 'File',
      type: 'file-upload',
      description:
        'One uploaded Sim UserFile; imports/loads may omit this to use an existing staged file',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_upload_request_attachment',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_load_viewpoint',
        ],
      },
      required: { field: 'operation', value: ['oracle_epm_edm_upload_request_attachment'] },
      canonicalParamId: 'file',
      mode: 'basic',
      multiple: false,
      canvasNoun: 'a file',
      placeholder: 'Upload one file (up to 95 MiB)',
    },
    {
      id: 'fileReference',
      title: 'File',
      type: 'short-input',
      description:
        'One uploaded Sim UserFile; imports/loads may omit this to use an existing staged file',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_upload_request_attachment',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_load_viewpoint',
        ],
      },
      required: { field: 'operation', value: ['oracle_epm_edm_upload_request_attachment'] },
      canonicalParamId: 'file',
      mode: 'advanced',
      canvasNoun: 'a file',
      placeholder: 'Reference a file from a previous block',
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      description: 'Single Oracle staging, attachment, or output file name; no directory path',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_upload_request_attachment',
          'oracle_epm_edm_generate_request_attachment',
          'oracle_epm_edm_get_job_result',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_load_viewpoint',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_edm_generate_request_attachment',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_load_viewpoint',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
      placeholder: 'Single Oracle staging, attachment, or output file name; no directory path',
    },
    {
      id: 'items',
      title: 'Items',
      type: 'code',
      description: 'Attachment rows: each has viewpoint and data cells with header and value',
      condition: { field: 'operation', value: ['oracle_epm_edm_generate_request_attachment'] },
      required: { field: 'operation', value: ['oracle_epm_edm_generate_request_attachment'] },
      language: 'json',
      placeholder: '[{"viewpoint":"Accounts","data":[{"header":"Name","value":"Account1"}]}]',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt:
          'Format the user-supplied EDM items as a JSON array like [{"viewpoint":"Accounts","data":[{"header":"Name","value":"Account1"}]}]. Use only supplied names/values; do not invent data. Return ONLY the JSON array.',
        placeholder: 'Describe or paste the values...',
      },
    },
    {
      id: 'overwrite',
      title: 'Overwrite',
      type: 'dropdown',
      description:
        'Whether to overwrite an existing generated request attachment; false is preserved',
      condition: { field: 'operation', value: ['oracle_epm_edm_generate_request_attachment'] },
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      mode: 'advanced',
    },
    {
      id: 'waitForCompletion',
      title: 'Wait For Completion',
      type: 'switch',
      description: 'Wait for the Oracle job (default true); false returns the job ID immediately',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_generate_request_attachment',
          'oracle_epm_edm_import_request_attachment',
          'oracle_epm_edm_transition_request',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_load_viewpoint',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
      defaultValue: true,
    },
    {
      id: 'maxWaitSeconds',
      title: 'Max Wait Seconds',
      type: 'short-input',
      description:
        'Maximum local wait (1-240 seconds; default 120); timeout does not cancel the remote job',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_generate_request_attachment',
          'oracle_epm_edm_import_request_attachment',
          'oracle_epm_edm_transition_request',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_load_viewpoint',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
      placeholder:
        'Maximum local wait (1-240 seconds; default 120); timeout does not cancel the remote job',
      mode: 'advanced',
    },
    {
      id: 'attachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      description: 'Saved request attachment UUID',
      condition: { field: 'operation', value: ['oracle_epm_edm_import_request_attachment'] },
      required: { field: 'operation', value: ['oracle_epm_edm_import_request_attachment'] },
      placeholder: 'Saved request attachment UUID',
    },
    {
      id: 'sheetNames',
      title: 'Sheet Names',
      type: 'code',
      description: 'Non-empty array of attachment sheet names to import',
      condition: { field: 'operation', value: ['oracle_epm_edm_import_request_attachment'] },
      required: { field: 'operation', value: ['oracle_epm_edm_import_request_attachment'] },
      language: 'json',
      placeholder: '["Name"]',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt:
          'Format the user-supplied EDM sheetNames as a JSON array like ["Accounts"]. Use only supplied names/values; do not invent data. Return ONLY the JSON array.',
        placeholder: 'Describe or paste the values...',
      },
    },
    {
      id: 'action',
      title: 'Action',
      type: 'dropdown',
      description: 'Requested workflow action; inspect validTransitionActions before choosing',
      condition: { field: 'operation', value: ['oracle_epm_edm_transition_request'] },
      required: { field: 'operation', value: ['oracle_epm_edm_transition_request'] },
      options: [
        { label: 'SUBMIT', id: 'SUBMIT' },
        { label: 'APPROVE', id: 'APPROVE' },
        { label: 'PUSHBACK', id: 'PUSHBACK' },
        { label: 'REJECT', id: 'REJECT' },
        { label: 'WITHDRAW', id: 'WITHDRAW' },
        { label: 'RECALL', id: 'RECALL' },
        { label: 'COMMIT', id: 'COMMIT' },
        { label: 'CLOSE', id: 'CLOSE' },
      ],
    },
    {
      id: 'transitionWithWarning',
      title: 'Transition With Warning',
      type: 'dropdown',
      description: 'Whether to allow the transition with validation warnings; false is preserved',
      condition: { field: 'operation', value: ['oracle_epm_edm_transition_request'] },
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      mode: 'advanced',
    },
    {
      id: 'jobRunId',
      title: 'Job Run ID',
      type: 'short-input',
      description: 'Oracle job UUID',
      condition: {
        field: 'operation',
        value: ['oracle_epm_edm_get_job_status', 'oracle_epm_edm_get_job_result'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_edm_get_job_status', 'oracle_epm_edm_get_job_result'],
      },
      placeholder: 'Oracle job UUID',
    },
    {
      id: 'downloadFile',
      title: 'Download File',
      type: 'switch',
      description:
        'Download a completed job file alongside its opaque result; supply the original staging file name when no file link is advertised (default false)',
      condition: { field: 'operation', value: ['oracle_epm_edm_get_job_result'] },
      mode: 'advanced',
    },
    {
      id: 'viewpointName',
      title: 'Viewpoint Name',
      type: 'short-input',
      description: 'Viewpoint name',
      condition: {
        field: 'operation',
        value: ['oracle_epm_edm_validate_viewpoint', 'oracle_epm_edm_load_viewpoint'],
      },
      required: {
        field: 'operation',
        value: ['oracle_epm_edm_validate_viewpoint', 'oracle_epm_edm_load_viewpoint'],
      },
      placeholder: 'Viewpoint name',
    },
    {
      id: 'bindingId',
      title: 'Binding ID',
      type: 'short-input',
      description: 'Dimension binding UUID',
      condition: { field: 'operation', value: ['oracle_epm_edm_get_mapping_keys'] },
      required: { field: 'operation', value: ['oracle_epm_edm_get_mapping_keys'] },
      placeholder: 'Dimension binding UUID',
    },
    {
      id: 'applicationName',
      title: 'Application Name',
      type: 'short-input',
      description: "Exact application name for Oracle's byName endpoint",
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
      placeholder: "Exact application name for Oracle's byName endpoint",
    },
    {
      id: 'dimensionName',
      title: 'Dimension Name',
      type: 'short-input',
      description: "Exact dimension name for Oracle's byName endpoint",
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
      placeholder: "Exact dimension name for Oracle's byName endpoint",
    },
    {
      id: 'mappingLocation',
      title: 'Mapping Location',
      type: 'short-input',
      description: 'Mapping location from Get Mapping Keys',
      condition: { field: 'operation', value: ['oracle_epm_edm_export_mappings'] },
      required: { field: 'operation', value: ['oracle_epm_edm_export_mappings'] },
      placeholder: 'Mapping location from Get Mapping Keys',
    },
    {
      id: 'connection',
      title: 'Connection',
      type: 'short-input',
      description:
        'Configured Oracle connection; omit to use staging and, for exports, return a Sim file',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
      placeholder:
        'Configured Oracle connection; omit to use staging and, for exports, return a Sim file',
      mode: 'advanced',
    },
    {
      id: 'importOption',
      title: 'Import Option',
      type: 'dropdown',
      description: 'Required import mode; no destructive provider default is applied',
      condition: { field: 'operation', value: ['oracle_epm_edm_import_dimension'] },
      required: { field: 'operation', value: ['oracle_epm_edm_import_dimension'] },
      options: [
        { label: 'ResetDimension', id: 'ResetDimension' },
        { label: 'ReplaceNodes', id: 'ReplaceNodes' },
        { label: 'Merge', id: 'Merge' },
      ],
    },
    {
      id: 'purpose',
      title: 'Purpose',
      type: 'short-input',
      description: 'Purpose or reason for loading the viewpoint',
      condition: { field: 'operation', value: ['oracle_epm_edm_load_viewpoint'] },
      required: { field: 'operation', value: ['oracle_epm_edm_load_viewpoint'] },
      placeholder: 'Purpose or reason for loading the viewpoint',
    },
    {
      id: 'loadOption',
      title: 'Load Option',
      type: 'dropdown',
      description: 'Required load mode; no provider default is applied',
      condition: { field: 'operation', value: ['oracle_epm_edm_load_viewpoint'] },
      required: { field: 'operation', value: ['oracle_epm_edm_load_viewpoint'] },
      options: [
        { label: 'ReplaceNodes', id: 'ReplaceNodes' },
        { label: 'Merge', id: 'Merge' },
      ],
    },
    {
      id: 'bindingNames',
      title: 'Binding Names',
      type: 'code',
      description: 'Non-empty array of dimension binding names',
      condition: { field: 'operation', value: ['oracle_epm_edm_incremental_export_dimension'] },
      required: { field: 'operation', value: ['oracle_epm_edm_incremental_export_dimension'] },
      language: 'json',
      placeholder: '["Name"]',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt:
          'Format the user-supplied EDM bindingNames as a JSON array like ["Corporate Account"]. Use only supplied names/values; do not invent data. Return ONLY the JSON array.',
        placeholder: 'Describe or paste the values...',
      },
    },
    {
      id: 'nodeChangeTypes',
      title: 'Node Change Types',
      type: 'code',
      description: 'Node changes to export: NEW, UPDATED, or both',
      condition: { field: 'operation', value: ['oracle_epm_edm_incremental_export_dimension'] },
      required: { field: 'operation', value: ['oracle_epm_edm_incremental_export_dimension'] },
      language: 'json',
      placeholder: '["NEW","UPDATED"]',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt:
          'Format the user-supplied EDM nodeChangeTypes as a JSON array like ["NEW","UPDATED"]. Use only supplied names/values; do not invent data. Return ONLY the JSON array.',
        placeholder: 'Describe or paste the values...',
      },
    },
    {
      id: 'since',
      title: 'Since',
      type: 'short-input',
      description:
        'Raw Oracle incremental timestamp; units are undocumented. Supply a tenant-confirmed value or use sinceLastExportOfType; no conversion is applied',
      condition: { field: 'operation', value: ['oracle_epm_edm_incremental_export_dimension'] },
      placeholder:
        'Raw Oracle incremental timestamp; units are undocumented. Supply a tenant-confirmed value or use sinceLastExportOfType; no conversion is applied',
      mode: 'advanced',
    },
    {
      id: 'sinceLastExportOfType',
      title: 'Since Last Export Of Type',
      type: 'dropdown',
      description:
        'Use a previous export as the incremental boundary; mutually exclusive with since',
      condition: { field: 'operation', value: ['oracle_epm_edm_incremental_export_dimension'] },
      options: [
        { label: 'FULL', id: 'FULL' },
        { label: 'INCREMENTAL', id: 'INCREMENTAL' },
      ],
    },
    {
      id: 'connectionName',
      title: 'Connection Name',
      type: 'short-input',
      description:
        'Configured Oracle connection name; omit to export to staging and return a Sim file',
      condition: { field: 'operation', value: ['oracle_epm_edm_incremental_export_dimension'] },
      placeholder:
        'Configured Oracle connection name; omit to export to staging and return a Sim file',
      mode: 'advanced',
    },
    {
      id: 'extractName',
      title: 'Extract Name',
      type: 'short-input',
      description: 'Name of the configured dimension viewpoint extract',
      condition: { field: 'operation', value: ['oracle_epm_edm_extract_dimension_viewpoint'] },
      required: { field: 'operation', value: ['oracle_epm_edm_extract_dimension_viewpoint'] },
      placeholder: 'Name of the configured dimension viewpoint extract',
    },
    {
      id: 'fromTime',
      title: 'From Time',
      type: 'short-input',
      description: 'Oracle-supported start timestamp (UTC, offset, or region format)',
      condition: { field: 'operation', value: ['oracle_epm_edm_extract_dimension_viewpoint'] },
      placeholder: 'Oracle-supported start timestamp (UTC, offset, or region format)',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Generate a UTC timestamp in YYYY-MM-DDTHH:MM:SS format. Return ONLY the timestamp string.',
        placeholder: 'Describe the date and time...',
      },
    },
    {
      id: 'toTime',
      title: 'To Time',
      type: 'short-input',
      description: 'Oracle-supported end timestamp (UTC, offset, or region format)',
      condition: { field: 'operation', value: ['oracle_epm_edm_extract_dimension_viewpoint'] },
      placeholder: 'Oracle-supported end timestamp (UTC, offset, or region format)',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Generate a UTC timestamp in YYYY-MM-DDTHH:MM:SS format. Return ONLY the timestamp string.',
        placeholder: 'Describe the date and time...',
      },
    },
  ],
  tools: {
    access: [
      'oracle_epm_edm_list_applications',
      'oracle_epm_edm_list_dimensions',
      'oracle_epm_edm_list_views',
      'oracle_epm_edm_list_viewpoints',
      'oracle_epm_edm_list_node_types',
      'oracle_epm_edm_get_node_type',
      'oracle_epm_edm_list_nodes',
      'oracle_epm_edm_get_node',
      'oracle_epm_edm_get_node_at_location',
      'oracle_epm_edm_browse_hierarchy',
      'oracle_epm_edm_create_request',
      'oracle_epm_edm_get_request',
      'oracle_epm_edm_query_requests',
      'oracle_epm_edm_get_request_lineage',
      'oracle_epm_edm_assign_request',
      'oracle_epm_edm_delete_request',
      'oracle_epm_edm_upload_request_attachment',
      'oracle_epm_edm_generate_request_attachment',
      'oracle_epm_edm_import_request_attachment',
      'oracle_epm_edm_transition_request',
      'oracle_epm_edm_get_job_status',
      'oracle_epm_edm_get_job_result',
      'oracle_epm_edm_validate_viewpoint',
      'oracle_epm_edm_get_mapping_keys',
      'oracle_epm_edm_export_mappings',
      'oracle_epm_edm_import_dimension',
      'oracle_epm_edm_load_viewpoint',
      'oracle_epm_edm_export_dimension',
      'oracle_epm_edm_incremental_export_dimension',
      'oracle_epm_edm_extract_dimension_viewpoint',
    ],
    config: { tool: (params) => params.operation, params: operationParams },
  },
  inputs: {
    operation: { type: 'string', description: 'EDM operation to perform' },
    oauthCredential: { type: 'string', description: 'Oracle EPM service-account credential' },
    applicationId: { type: 'string', description: 'Application UUID' },
    permission: {
      type: 'string',
      description:
        'One application permission: owner, datamanager, participant, or participant_with_write',
    },
    maxResults: {
      type: 'number',
      description:
        'Maximum projected items (1-500; default 200). This is a local result cap, not provider pagination.',
    },
    dimensionId: { type: 'string', description: 'Dimension UUID' },
    objectStatus: { type: 'string', description: 'One view status filter' },
    viewId: { type: 'string', description: 'View UUID' },
    viewpointId: { type: 'string', description: 'Viewpoint UUID' },
    nodeTypeId: {
      type: 'string',
      description: 'Node-type UUID assigned to the selected viewpoint',
    },
    scope: {
      type: 'string',
      description:
        'Node listing scope (default top); children requires parentNodeId, request requires requestId',
    },
    parentNodeId: { type: 'string', description: 'Parent node UUID for children scope only' },
    requestId: {
      type: 'string',
      description: 'Request UUID; for node listing it requires request scope',
    },
    expand: { type: 'string', description: 'One documented node expansion' },
    limit: { type: 'number', description: 'Node page size (1-100; default 50)' },
    offset: { type: 'number', description: 'Node page offset (0-1000000; default 0)' },
    fromId: {
      type: 'string',
      description:
        'Nodes after this node UUID; append * to include it, or use first. Cannot combine with toId.',
    },
    toId: {
      type: 'string',
      description:
        'Nodes before this node UUID; append * to include it, or use last. Cannot combine with fromId.',
    },
    orderBy: { type: 'string', description: 'Hierarchy-set node order' },
    nodeId: { type: 'string', description: 'Node UUID' },
    location: {
      type: 'string',
      description: 'Comma-separated ancestor/node UUIDs, root first (maximum 255 characters)',
    },
    maxDepth: {
      type: 'number',
      description: 'Maximum traversal depth (0-3; default 2); roots have depth zero',
    },
    maxNodes: { type: 'number', description: 'Maximum hierarchy occurrences (1-500; default 200)' },
    pageSize: { type: 'number', description: 'Hierarchy provider page size (1-100; default 50)' },
    maxRequests: {
      type: 'number',
      description: 'Maximum hierarchy provider requests (1-100; default 50)',
    },
    title: { type: 'string', description: 'Request title' },
    description: { type: 'string', description: 'Request description' },
    notes: { type: 'string', description: 'Request notes' },
    priority: { type: 'string', description: 'Priority for a new request' },
    queryPriority: { type: 'string', description: 'One request priority filter' },
    timeLabelName: {
      type: 'string',
      description: 'Time label name; request queries support one value',
    },
    lastDays: {
      type: 'number',
      description: 'Previous days to query (1-90; default 30 when no explicit dates are supplied)',
    },
    fromDate: {
      type: 'number',
      description:
        'Inclusive start in epoch seconds; provide with toDate, without lastDays, within 90 days',
    },
    toDate: {
      type: 'number',
      description: 'End in epoch seconds; provide with fromDate, without lastDays, within 90 days',
    },
    myActivity: { type: 'string', description: 'One activity filter' },
    owner: { type: 'string', description: 'One request owner name' },
    requestNumber: {
      type: 'number',
      description: 'Positive Oracle request number, not request UUID',
    },
    requestType: { type: 'string', description: 'One request-type filter' },
    stage: {
      type: 'string',
      description: 'One request-stage query filter, using Oracle query spelling',
    },
    status: { type: 'string', description: 'One request-status query filter' },
    viewName: { type: 'string', description: 'View name; request queries accept one value' },
    expandWorkflow: {
      type: 'boolean',
      description: 'Include documented workflow information in request queries',
    },
    userName: { type: 'string', description: 'Oracle user name to receive the request' },
    comment: { type: 'string', description: 'Workflow or assignment comment' },
    file: {
      type: 'file',
      description:
        'One uploaded Sim UserFile; imports/loads may omit this to use an existing staged file',
    },
    fileName: {
      type: 'string',
      description: 'Single Oracle staging, attachment, or output file name; no directory path',
    },
    items: {
      type: 'array',
      description: 'Attachment rows: each has viewpoint and data cells with header and value',
    },
    overwrite: {
      type: 'boolean',
      description:
        'Whether to overwrite an existing generated request attachment; false is preserved',
    },
    waitForCompletion: {
      type: 'boolean',
      description: 'Wait for the Oracle job (default true); false returns the job ID immediately',
    },
    maxWaitSeconds: {
      type: 'number',
      description:
        'Maximum local wait (1-240 seconds; default 120); timeout does not cancel the remote job',
    },
    attachmentId: { type: 'string', description: 'Saved request attachment UUID' },
    sheetNames: {
      type: 'array',
      description: 'Non-empty array of attachment sheet names to import',
    },
    action: {
      type: 'string',
      description: 'Requested workflow action; inspect validTransitionActions before choosing',
    },
    transitionWithWarning: {
      type: 'boolean',
      description: 'Whether to allow the transition with validation warnings; false is preserved',
    },
    jobRunId: { type: 'string', description: 'Oracle job UUID' },
    downloadFile: {
      type: 'boolean',
      description:
        'Download a completed job file alongside its opaque result; supply the original staging file name when no file link is advertised (default false)',
    },
    viewpointName: { type: 'string', description: 'Viewpoint name' },
    bindingId: { type: 'string', description: 'Dimension binding UUID' },
    applicationName: {
      type: 'string',
      description: "Exact application name for Oracle's byName endpoint",
    },
    dimensionName: {
      type: 'string',
      description: "Exact dimension name for Oracle's byName endpoint",
    },
    mappingLocation: { type: 'string', description: 'Mapping location from Get Mapping Keys' },
    connection: {
      type: 'string',
      description:
        'Configured Oracle connection; omit to use staging and, for exports, return a Sim file',
    },
    importOption: {
      type: 'string',
      description: 'Required import mode; no destructive provider default is applied',
    },
    purpose: { type: 'string', description: 'Purpose or reason for loading the viewpoint' },
    loadOption: {
      type: 'string',
      description: 'Required load mode; no provider default is applied',
    },
    bindingNames: { type: 'array', description: 'Non-empty array of dimension binding names' },
    nodeChangeTypes: {
      type: 'array',
      description: 'Node changes to export: NEW, UPDATED, or both',
    },
    since: {
      type: 'number',
      description:
        'Raw Oracle incremental timestamp; units are undocumented. Supply a tenant-confirmed value or use sinceLastExportOfType; no conversion is applied',
    },
    sinceLastExportOfType: {
      type: 'string',
      description:
        'Use a previous export as the incremental boundary; mutually exclusive with since',
    },
    connectionName: {
      type: 'string',
      description:
        'Configured Oracle connection name; omit to export to staging and return a Sim file',
    },
    extractName: {
      type: 'string',
      description: 'Name of the configured dimension viewpoint extract',
    },
    fromTime: {
      type: 'string',
      description: 'Oracle-supported start timestamp (UTC, offset, or region format)',
    },
    toTime: {
      type: 'string',
      description: 'Oracle-supported end timestamp (UTC, offset, or region format)',
    },
  },
  outputs: {
    applications: {
      type: 'json',
      description: 'Bounded applications with dimensions',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_applications'] },
    },
    dimensions: {
      type: 'json',
      description: 'Bounded application dimensions',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_dimensions'] },
    },
    views: {
      type: 'json',
      description: 'Bounded views',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_views'] },
    },
    viewpoints: {
      type: 'json',
      description: 'Bounded viewpoints',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_viewpoints'] },
    },
    nodeTypes: {
      type: 'json',
      description: 'Bounded viewpoint-assigned node types',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_node_types'] },
    },
    nodeType: {
      type: 'json',
      description: 'Viewpoint-assigned node-type reference',
      condition: { field: 'operation', value: ['oracle_epm_edm_get_node_type'] },
    },
    node: {
      type: 'json',
      description: 'Node detail and documented validation information',
      condition: {
        field: 'operation',
        value: ['oracle_epm_edm_get_node', 'oracle_epm_edm_get_node_at_location'],
      },
    },
    nodes: {
      type: 'array',
      description:
        'Flat node page or hierarchy occurrences with traversal paths; hierarchy nodes are capped at 5 MiB with remaining-frontier diagnostics',
      condition: {
        field: 'operation',
        value: ['oracle_epm_edm_list_nodes', 'oracle_epm_edm_browse_hierarchy'],
      },
    },
    request: {
      type: 'json',
      description:
        'Request workflow, permitted transitions, validation information, and source relationships',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_create_request',
          'oracle_epm_edm_get_request',
          'oracle_epm_edm_assign_request',
        ],
      },
    },
    requests: {
      type: 'json',
      description: 'Bounded request collection',
      condition: { field: 'operation', value: ['oracle_epm_edm_query_requests'] },
    },
    lineage: {
      type: 'json',
      description: 'Request lineage and subscription processing instances',
      condition: { field: 'operation', value: ['oracle_epm_edm_get_request_lineage'] },
    },
    job: {
      type: 'json',
      description: 'Oracle job snapshot; null when submitted without waiting',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_generate_request_attachment',
          'oracle_epm_edm_import_request_attachment',
          'oracle_epm_edm_transition_request',
          'oracle_epm_edm_get_job_status',
          'oracle_epm_edm_get_job_result',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_load_viewpoint',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
    },
    result: {
      type: 'json',
      description: 'Job-result envelope with an opaque nested result payload',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_generate_request_attachment',
          'oracle_epm_edm_import_request_attachment',
          'oracle_epm_edm_transition_request',
          'oracle_epm_edm_get_job_result',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_load_viewpoint',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
    },
    file: {
      type: 'file',
      description: 'Downloaded canonical Sim UserFile',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_get_job_result',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
    },
    jobId: {
      type: 'string',
      description: 'Job UUID for resumable polling',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_generate_request_attachment',
          'oracle_epm_edm_import_request_attachment',
          'oracle_epm_edm_transition_request',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_load_viewpoint',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
    },
    completed: {
      type: 'boolean',
      description:
        'Whether Oracle reports job status COMPLETED; inspect result and reports for business success',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_generate_request_attachment',
          'oracle_epm_edm_import_request_attachment',
          'oracle_epm_edm_transition_request',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_load_viewpoint',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
    },
    timedOut: {
      type: 'boolean',
      description: 'Whether local polling timed out without cancelling the Oracle job',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_generate_request_attachment',
          'oracle_epm_edm_import_request_attachment',
          'oracle_epm_edm_transition_request',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_import_dimension',
          'oracle_epm_edm_load_viewpoint',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
    },
    fileName: {
      type: 'string',
      description: 'Original Oracle staging or output file name',
      condition: {
        field: 'operation',
        value: [
          'oracle_epm_edm_upload_request_attachment',
          'oracle_epm_edm_validate_viewpoint',
          'oracle_epm_edm_export_mappings',
          'oracle_epm_edm_export_dimension',
          'oracle_epm_edm_incremental_export_dimension',
          'oracle_epm_edm_extract_dimension_viewpoint',
        ],
      },
    },
    applicationId: {
      type: 'string',
      description: 'Selected application UUID',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_dimensions'] },
    },
    requestId: {
      type: 'string',
      description: 'Selected request UUID',
      condition: {
        field: 'operation',
        value: ['oracle_epm_edm_delete_request', 'oracle_epm_edm_upload_request_attachment'],
      },
    },
    attachmentId: {
      type: 'string',
      description: 'Uploaded attachment UUID',
      condition: { field: 'operation', value: ['oracle_epm_edm_upload_request_attachment'] },
    },
    attachmentUri: {
      type: 'string',
      description: 'Validated attachment URI',
      condition: { field: 'operation', value: ['oracle_epm_edm_upload_request_attachment'] },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether request deletion was accepted',
      condition: { field: 'operation', value: ['oracle_epm_edm_delete_request'] },
    },
    count: {
      type: 'number',
      description: 'Returned node count',
      condition: {
        field: 'operation',
        value: ['oracle_epm_edm_list_nodes', 'oracle_epm_edm_browse_hierarchy'],
      },
    },
    offset: {
      type: 'number',
      description: 'Node page offset',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_nodes'] },
    },
    nextOffset: {
      type: 'number',
      description: 'Next node page offset, or null',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_nodes'] },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more nodes may exist',
      condition: { field: 'operation', value: ['oracle_epm_edm_list_nodes'] },
    },
    truncated: {
      type: 'boolean',
      description: 'Whether bounded output is incomplete',
      condition: {
        field: 'operation',
        value: ['oracle_epm_edm_list_nodes', 'oracle_epm_edm_browse_hierarchy'],
      },
    },
    providerRequests: {
      type: 'number',
      description: 'Provider calls used by hierarchy traversal',
      condition: { field: 'operation', value: ['oracle_epm_edm_browse_hierarchy'] },
    },
    truncationReasons: {
      type: 'array',
      description: 'Limits, repeated pages, or cycles encountered',
      condition: { field: 'operation', value: ['oracle_epm_edm_browse_hierarchy'] },
    },
    remainingFrontier: {
      type: 'array',
      description: 'Unvisited parent locations, paths, depths, and offsets',
      condition: { field: 'operation', value: ['oracle_epm_edm_browse_hierarchy'] },
    },
    mapKeys: {
      type: 'array',
      description: 'Mapping locations and node-type references',
      condition: { field: 'operation', value: ['oracle_epm_edm_get_mapping_keys'] },
    },
  },
}

export const OracleEpmEnterpriseDataManagementBlockMeta = {
  tags: ['automation', 'data-analytics'],
  url: 'https://www.oracle.com/performance-management/enterprise-data-management/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Submit governed dimension changes',
      prompt:
        'Create an Oracle EDM request in a selected view, upload a user-provided request spreadsheet, import the selected sheets, poll the import job, inspect the request and its valid transitions, then submit only after the user authorizes submission.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation', 'data-sync'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review and approve an EDM request',
      prompt:
        'Query recent Oracle EDM requests, retrieve the selected request and lineage, summarize validation information, and apply APPROVE only after an authorized reviewer explicitly chooses that available transition.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation', 'data-sync'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Validate before exporting a dimension',
      prompt:
        "Validate an Oracle EDM viewpoint to a report file, inspect the downloaded report, and export its dimension by name only if validation meets the user's acceptance criteria.",
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation', 'data-sync'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Merge approved master-data updates',
      prompt:
        'Import a user-provided dimension file into Oracle EDM with the explicitly selected Merge mode, poll completion, inspect the opaque job result and resulting requests, and report any requests that remain in draft.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation', 'data-sync'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Investigate subscription-generated requests',
      prompt:
        'Query Oracle EDM subscription requests from the last 30 days, inspect their source-request relationships and lineage, and prepare a digest of blocked or incomplete subscription processing.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation', 'data-sync'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Export governed mapping data',
      prompt:
        "Find an Oracle EDM application's dimension binding, retrieve its mapping keys, choose the mapping location, and export mappings to a file for a downstream data-management workflow.",
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation', 'data-sync'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Deliver incremental dimension changes',
      prompt:
        'Export new or updated Oracle EDM nodes using an explicit previous-export boundary, wait for completion, and deliver the resulting file while reporting the limitations of transaction-history incremental exports.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation', 'data-sync'],
    },
  ],
  skills: [
    {
      name: 'submit-edm-changes',
      description: 'Submit governed dimension changes',
      content:
        '# Submit governed dimension changes\n\n## Steps\n\nCreate Request → Upload Request Attachment → Import Request Attachment → Get Job Status/Result → Get Request → Transition Request (SUBMIT). Do not resubmit writes after a timeout; retain the job ID. Inspect validation messages and validTransitionActions before submitting.\n\n## Output\n\nReport the actual Oracle state, bounded-result diagnostics, and any job/file identifiers needed to resume. Distinguish submission, completion, and business validation.\n\n## Source\n\n[Oracle workflow documentation](https://docs.oracle.com/en/cloud/saas/enterprise-data-management-cloud/dmcaa/request_process_flow_102xde8fe387.html)',
    },
    {
      name: 'approve-edm-request',
      description: 'Review and approve an EDM request',
      content:
        '# Review and approve an EDM request\n\n## Steps\n\nQuery Requests with one value per filter and at most 90 days. Get Request and Get Request Lineage. Present validation and validTransitionActions, then invoke only the user-selected transition. Approval may leave a further commit stage; report actual status.\n\n## Output\n\nReport the actual Oracle state, bounded-result diagnostics, and any job/file identifiers needed to resume. Distinguish submission, completion, and business validation.\n\n## Source\n\n[Oracle workflow documentation](https://docs.oracle.com/en/cloud/saas/enterprise-data-management-cloud/dmcaa/request_process_flow_102xde8fe387.html)',
    },
    {
      name: 'validate-edm-export',
      description: 'Validate before exporting a dimension',
      content:
        '# Validate before exporting a dimension\n\n## Steps\n\nValidate Viewpoint with a unique output file name. Poll and retrieve the report as a Sim file. Review it before Export Dimension. Job completion alone does not imply a report contains zero validation issues.\n\n## Output\n\nReport the actual Oracle state, bounded-result diagnostics, and any job/file identifiers needed to resume. Distinguish submission, completion, and business validation.\n\n## Source\n\n[Oracle workflow documentation](https://docs.oracle.com/en/cloud/saas/enterprise-data-management-cloud/dmcaa/validate_viewpoint_100x0b596a96.html)',
    },
    {
      name: 'merge-edm-dimension',
      description: 'Merge approved master-data updates',
      content:
        '# Merge approved master-data updates\n\n## Steps\n\nImport Dimension with an authorized Sim file and explicit Merge mode. Preserve the job ID; inspect Get Job Result without assuming undocumented nested fields. Query Requests to identify resulting import requests; draft requests can contain validation errors. Never silently choose ResetDimension or ReplaceNodes.\n\n## Output\n\nReport the actual Oracle state, bounded-result diagnostics, and any job/file identifiers needed to resume. Distinguish submission, completion, and business validation.\n\n## Source\n\n[Oracle workflow documentation](https://docs.oracle.com/en/cloud/saas/enterprise-data-management-cloud/dmcaa/working_with_merge_imports_100xd9c958aa.html)',
    },
    {
      name: 'triage-edm-subscriptions',
      description: 'Investigate subscription-generated requests',
      content:
        '# Investigate subscription-generated requests\n\n## Steps\n\nQuery Requests with requestType Subscription and lastDays 30. Inspect each selected request and its lineage, including incomplete subscription instances and source relationships. This integration observes existing subscriptions; it does not create or administer them.\n\n## Output\n\nReport the actual Oracle state, bounded-result diagnostics, and any job/file identifiers needed to resume. Distinguish submission, completion, and business validation.\n\n## Source\n\n[Oracle workflow documentation](https://docs.oracle.com/en/cloud/saas/enterprise-data-management-cloud/dmcaa/subscribing_to_viewpoints_100x8dae1bc3.html)',
    },
    {
      name: 'export-edm-mappings',
      description: 'Export governed mapping data',
      content:
        '# Export governed mapping data\n\n## Steps\n\nList Applications/Dimensions to select a binding. Get Mapping Keys using dimension and binding IDs. Export Mappings with exact application/dimension names and the selected location. Wait for the job and return the stored Sim file, or retain job ID and file name to resume.\n\n## Output\n\nReport the actual Oracle state, bounded-result diagnostics, and any job/file identifiers needed to resume. Distinguish submission, completion, and business validation.\n\n## Source\n\n[Oracle workflow documentation](https://docs.oracle.com/en/cloud/saas/enterprise-data-management-cloud/dmcaa/export_mapping_100x31f0bcc0.html)',
    },
    {
      name: 'export-edm-increments',
      description: 'Deliver incremental dimension changes',
      content:
        '# Deliver incremental dimension changes\n\n## Steps\n\nIncremental Export Dimension requires bindingNames and nodeChangeTypes, plus exactly one since or sinceLastExportOfType. Preserve job ID and original file name for resumed downloads. Incremental exports omit some derived/inherited and Reset/Replace bulk changes; use an existing incremental extract profile when comparing versions is needed.\n\n## Output\n\nReport the actual Oracle state, bounded-result diagnostics, and any job/file identifiers needed to resume. Distinguish submission, completion, and business validation.\n\n## Source\n\n[Oracle workflow documentation](https://docs.oracle.com/en/cloud/saas/enterprise-data-management-cloud/dmcaa/../edmra/edmcs_use_cases_export.html)',
    },
  ],
} as const satisfies BlockMeta
