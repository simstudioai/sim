import type { ToolConfig } from '@/tools/types'

type ToolParams = ToolConfig['params']

/**
 * Credential and portal-addressing params every ServiceDesk Plus tool declares.
 *
 * All three are `hidden` or `user-only`: the access token is injected from the
 * credential, and the data center and portal address the customer's own tenant
 * rather than describing the operation, so an LLM has no business choosing
 * them.
 */
export const SDP_BASE_PARAMS: ToolParams = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'ManageEngine ServiceDesk Plus Cloud OAuth access token',
  },
  dataCenter: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description:
      'Zoho data center hosting the portal (US, EU, IN, AU, JP, CA, SA, UK, CN, AE). Credentials connected through Sim are issued by the US accounts server and are only valid against US.',
  },
  portal: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'Portal URL name. Leave empty to use the account default portal',
  },
}

/**
 * `list_info` params shared by every GET-list endpoint. Exposed to the model as
 * `user-or-llm` because paging and filtering a list is part of the operation an
 * agent is asked to perform.
 */
export const SDP_LIST_PARAMS: ToolParams = {
  rowCount: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Rows to return (maximum 100)',
  },
  startIndex: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'One-based index of the first row to return',
  },
  sortField: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Field to sort on, e.g. created_time',
  },
  sortOrder: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Sort direction: asc or desc',
  },
  searchCriteria: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Search criteria object or array, e.g. {"field":"status.name","condition":"is","value":"Open"}',
  },
  fieldsRequired: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Array of field names to return, e.g. ["subject","status"]',
  },
  getTotalCount: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Include the total matching row count in list_info',
  },
}

/**
 * Optional problem fields, shared by Create Problem and Update Problem. The
 * mandatory `title` is declared per tool, because it is required only on create.
 */
export const SDP_PROBLEM_WRITE_PARAMS: ToolParams = {
  description: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Problem description. HTML is supported',
  },
  reportedByEmail: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Email address of the user reporting the problem',
  },
  technicianEmail: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Email address of the technician to assign',
  },
  priority: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Priority name, e.g. High',
  },
  status: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Status name, e.g. Open',
  },
  urgency: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Urgency name',
  },
  impact: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Impact name',
  },
  category: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Category name',
  },
  subcategory: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Subcategory name',
  },
  group: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Support group name',
  },
  site: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Site name' },
  udfFields: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Portal-defined custom fields, e.g. {"udf_char1":"value"}',
  },
}

/**
 * Optional change fields, shared by Create Change and Update Change. The
 * mandatory `title`, `stage` and `status` are declared per tool, because they
 * are required only on create.
 */
export const SDP_CHANGE_WRITE_PARAMS: ToolParams = {
  description: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Change description. HTML is supported',
  },
  changeTypeName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Change type name, e.g. Standard',
  },
  reasonForChange: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Reason-for-change name',
  },
  priority: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Priority name',
  },
  urgency: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Urgency name',
  },
  impact: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Impact name',
  },
  group: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Support group name',
  },
  changeRequesterEmail: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Email address of the change requester',
  },
  changeOwnerEmail: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Email address of the change owner',
  },
  changeManagerEmail: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Email address of the change manager',
  },
  scheduledStartTime: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Scheduled start, as an ISO 8601 timestamp or epoch milliseconds',
  },
  scheduledEndTime: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Scheduled end, as an ISO 8601 timestamp or epoch milliseconds',
  },
  emergency: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Whether this is an emergency change',
  },
  comment: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Reason for the status update. ServiceDesk Plus requires this when status changes',
  },
  udfFields: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Portal-defined custom fields, e.g. {"udf_char1":"value"}',
  },
}

/**
 * Optional asset fields, shared by Create Asset and Update Asset. The mandatory
 * `name` and `product` are declared per tool, because they are required only on
 * create.
 */
export const SDP_ASSET_WRITE_PARAMS: ToolParams = {
  productType: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Product type name, e.g. Laptop',
  },
  assetTag: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Asset tag',
  },
  serialNumber: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Serial number',
  },
  barcode: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Barcode' },
  ipAddress: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'IP address',
  },
  macAddress: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'MAC address',
  },
  location: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Location' },
  state: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Asset state name, e.g. In Use',
  },
  vendor: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Vendor name',
  },
  department: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Department name',
  },
  site: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Site name' },
  userEmail: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Email address of the user the asset is assigned to',
  },
  stateHistoryComments: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Comment recorded against a state change',
  },
  udfFields: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Portal-defined custom fields, e.g. {"udf_char1":"value"}',
  },
}

/**
 * Optional solution fields, shared by Create Solution and Update Solution. The
 * mandatory `title`, `description` and `topic` are declared per tool, because
 * they are required only on create.
 */
export const SDP_SOLUTION_WRITE_PARAMS: ToolParams = {
  keywords: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Search keywords for the solution',
  },
  isPublic: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Whether requesters can see the solution. Only takes effect once the solution is Approved',
  },
  udfFields: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'Portal-defined custom fields, e.g. {"udf_char1":"value"}',
  },
}
