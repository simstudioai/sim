import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

/**
 * Fields injected server-side (or chosen in the block) that every ServiceDesk
 * Plus Cloud call needs before it can address a portal in the right region.
 */
export interface SdpBaseParams {
  accessToken: string
  /**
   * Data-center code selecting the API host. See
   * {@link import('./data-centers').SDP_DATA_CENTER_BASES}.
   */
  dataCenter?: string
  /**
   * Portal URL name. SDP serves every portal from `/app/{portal}/api/v3`, and
   * omitting it addresses the account's default portal.
   */
  portal?: string
}

/** `list_info` input accepted by every GET-list endpoint. */
export interface SdpListParams extends SdpBaseParams {
  rowCount?: number
  startIndex?: number
  sortField?: string
  sortOrder?: string
  searchCriteria?: unknown
  fieldsRequired?: unknown
  getTotalCount?: boolean
}

export interface SdpCreateRequestParams extends SdpBaseParams {
  subject: string
  description?: string
  requesterEmail?: string
  priority?: string
  status?: string
  category?: string
  subcategory?: string
  group?: string
  technicianEmail?: string
  urgency?: string
  impact?: string
  requestType?: string
  udfFields?: unknown
}

export interface SdpUpdateRequestParams extends SdpBaseParams {
  requestId: string
  subject?: string
  description?: string
  priority?: string
  status?: string
  category?: string
  subcategory?: string
  group?: string
  technicianEmail?: string
  urgency?: string
  impact?: string
  udfFields?: unknown
}

export interface SdpGetRequestParams extends SdpBaseParams {
  requestId: string
}

export interface SdpAddRequestNoteParams extends SdpBaseParams {
  requestId: string
  description: string
  showToRequester?: boolean
  notifyTechnician?: boolean
  markFirstResponse?: boolean
  addToLinkedRequests?: boolean
}

export interface SdpListRequestNotesParams extends SdpListParams {
  requestId: string
}

export interface SdpGetProblemParams extends SdpBaseParams {
  problemId: string
}

export interface SdpGetChangeParams extends SdpBaseParams {
  changeId: string
}

export interface SdpDeleteRequestParams extends SdpBaseParams {
  requestId: string
}

/** Shared by Add Problem and Edit Problem; `title` is mandatory only on Add. */
export interface SdpProblemWriteParams extends SdpBaseParams {
  problemId?: string
  title?: string
  description?: string
  reportedByEmail?: string
  technicianEmail?: string
  priority?: string
  status?: string
  urgency?: string
  impact?: string
  category?: string
  subcategory?: string
  group?: string
  site?: string
  udfFields?: unknown
}

export interface SdpDeleteProblemParams extends SdpBaseParams {
  problemId: string
}

/**
 * Shared by Add Change and Edit Change. `title`, `stage` and `status` are
 * mandatory on Add; on Edit, SDP additionally requires `comment` whenever
 * `status` changes.
 */
export interface SdpChangeWriteParams extends SdpBaseParams {
  changeId?: string
  title?: string
  description?: string
  stage?: string
  status?: string
  changeTypeName?: string
  reasonForChange?: string
  priority?: string
  urgency?: string
  impact?: string
  group?: string
  changeRequesterEmail?: string
  changeOwnerEmail?: string
  changeManagerEmail?: string
  scheduledStartTime?: string
  scheduledEndTime?: string
  emergency?: boolean
  comment?: string
  udfFields?: unknown
}

export interface SdpDeleteChangeParams extends SdpBaseParams {
  changeId: string
}

export interface SdpGetAssetParams extends SdpBaseParams {
  assetId: string
}

/** Shared by Add Asset and Edit Asset; `name` and `product` are mandatory on Add. */
export interface SdpAssetWriteParams extends SdpBaseParams {
  assetId?: string
  name?: string
  product?: string
  productType?: string
  assetTag?: string
  serialNumber?: string
  barcode?: string
  ipAddress?: string
  macAddress?: string
  location?: string
  state?: string
  vendor?: string
  department?: string
  site?: string
  userEmail?: string
  stateHistoryComments?: string
  udfFields?: unknown
}

export interface SdpDeleteAssetParams extends SdpBaseParams {
  assetId: string
}

export interface SdpGetSolutionParams extends SdpBaseParams {
  solutionId: string
}

/**
 * Shared by Add Solution and Edit Solution; `title`, `description` and `topic`
 * are mandatory on Add.
 */
export interface SdpSolutionWriteParams extends SdpBaseParams {
  solutionId?: string
  title?: string
  description?: string
  topic?: string
  keywords?: string
  isPublic?: boolean
  udfFields?: unknown
}

export interface SdpDeleteSolutionParams extends SdpBaseParams {
  solutionId: string
}

/** Edit variants, where the entity id the write addresses is mandatory. */
export interface SdpUpdateProblemParams extends SdpProblemWriteParams {
  problemId: string
}

export interface SdpUpdateChangeParams extends SdpChangeWriteParams {
  changeId: string
}

export interface SdpUpdateAssetParams extends SdpAssetWriteParams {
  assetId: string
}

export interface SdpUpdateSolutionParams extends SdpSolutionWriteParams {
  solutionId: string
}

export interface SdpAddProblemNoteParams extends SdpBaseParams {
  problemId: string
  description: string
}

export interface SdpListProblemNotesParams extends SdpListParams {
  problemId: string
}

export interface SdpAddChangeNoteParams extends SdpBaseParams {
  changeId: string
  description: string
}

export interface SdpListChangeNotesParams extends SdpListParams {
  changeId: string
}

export interface SdpResponse extends ToolResponse {
  output: Record<string, unknown>
}

/**
 * Nested `{ id, name }` lookup objects appear on almost every SDP field
 * (status, priority, group, category, ...). Declared once so each entity's
 * property map can point at the same shape.
 */
const LOOKUP_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Identifier', optional: true },
  name: { type: 'string', description: 'Display name', optional: true },
}

/**
 * SDP renders every timestamp as a `{ display_value, value }` pair, where
 * `value` is epoch milliseconds as a string.
 */
const TIME_PROPERTIES: Record<string, ToolOutputProperty> = {
  display_value: {
    type: 'string',
    description: 'Human-readable timestamp in the portal timezone',
    optional: true,
  },
  value: { type: 'string', description: 'Epoch milliseconds as a string', optional: true },
}

/**
 * Problems, changes and solutions carry `display_id` as a `{ display_value,
 * value }` pair — the same *shape* as a timestamp but not the same meaning:
 * `display_value` is the prefixed record number shown in the UI ("PB-140",
 * "CH 44", "SOL-1") and `value` is its bare sequence number ("140"). Declared
 * separately from {@link TIME_PROPERTIES} so the generated tool metadata never
 * tells a consumer that `140` is epoch milliseconds.
 *
 * Requests differ again: their `display_id` is a plain string.
 */
const DISPLAY_ID_PROPERTIES: Record<string, ToolOutputProperty> = {
  display_value: {
    type: 'string',
    description: 'Record number as shown in the UI, e.g. PB-140',
    optional: true,
  },
  value: { type: 'string', description: 'Bare sequence number, e.g. 140', optional: true },
}

const USER_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'User ID', optional: true },
  name: { type: 'string', description: 'User name', optional: true },
  email_id: { type: 'string', description: 'Email address', optional: true, nullable: true },
  phone: { type: 'string', description: 'Phone number', optional: true, nullable: true },
  mobile: { type: 'string', description: 'Mobile number', optional: true, nullable: true },
  is_technician: {
    type: 'boolean',
    description: 'Whether the user is a technician',
    optional: true,
  },
  is_vip_user: { type: 'boolean', description: 'Whether the user is flagged VIP', optional: true },
  job_title: { type: 'string', description: 'Job title', optional: true, nullable: true },
}

/**
 * Verified against the Add / Get / Get List response samples on
 * https://www.manageengine.com/products/service-desk/sdpod-v3-api/requests/request.html.
 * Only the fields those samples actually carry are declared; the full request
 * object is far wider and portal-dependent, so consumers that need a field not
 * listed here read it off the raw object.
 */
export const SDP_REQUEST_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Request ID' },
  display_id: {
    type: 'string',
    description: 'Request number shown in the SDP UI',
    optional: true,
  },
  subject: { type: 'string', description: 'Request subject', optional: true },
  description: {
    type: 'string',
    description: 'Request description (HTML)',
    optional: true,
    nullable: true,
  },
  status: {
    type: 'json',
    description: 'Current status',
    optional: true,
    nullable: true,
    properties: {
      ...LOOKUP_PROPERTIES,
      color: { type: 'string', description: 'Status colour', optional: true },
      in_progress: {
        type: 'boolean',
        description: 'Whether the status is in progress',
        optional: true,
      },
      internal_name: { type: 'string', description: 'Internal status name', optional: true },
      stop_timer: { type: 'boolean', description: 'Whether the SLA timer stops', optional: true },
    },
  },
  priority: {
    type: 'json',
    description: 'Priority',
    optional: true,
    nullable: true,
    properties: {
      ...LOOKUP_PROPERTIES,
      color: { type: 'string', description: 'Priority colour', optional: true },
    },
  },
  requester: {
    type: 'json',
    description: 'Requester',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  technician: {
    type: 'json',
    description: 'Assigned technician',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  group: {
    type: 'json',
    description: 'Support group',
    optional: true,
    nullable: true,
    properties: {
      ...LOOKUP_PROPERTIES,
      site: { type: 'string', description: 'Site the group belongs to', optional: true },
      deleted: { type: 'boolean', description: 'Whether the group is deleted', optional: true },
    },
  },
  category: {
    type: 'json',
    description: 'Category',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  subcategory: {
    type: 'json',
    description: 'Subcategory',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  urgency: {
    type: 'json',
    description: 'Urgency',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  impact: {
    type: 'json',
    description: 'Impact',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  template: {
    type: 'json',
    description: 'Request template',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  site: {
    type: 'json',
    description: 'Site',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  created_time: {
    type: 'json',
    description: 'Creation time',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  due_by_time: {
    type: 'json',
    description: 'SLA due time',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  resolved_time: {
    type: 'json',
    description: 'Resolution time',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  completed_time: {
    type: 'json',
    description: 'Completion time',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  is_service_request: {
    type: 'boolean',
    description: 'Whether this is a service request rather than an incident',
    optional: true,
  },
  has_notes: { type: 'boolean', description: 'Whether the request has notes', optional: true },
  udf_fields: {
    type: 'json',
    description: 'Portal-defined custom fields',
    optional: true,
    nullable: true,
  },
}

/**
 * Verified against the Add / Get / Get List response samples on
 * https://www.manageengine.com/products/service-desk/sdpod-v3-api/requests/request_note.html.
 */
export const SDP_REQUEST_NOTE_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Note ID' },
  description: { type: 'string', description: 'Note body (HTML)', optional: true },
  show_to_requester: {
    type: 'boolean',
    description: 'Whether the note is visible to the requester',
    optional: true,
  },
  notify_technician: {
    type: 'boolean',
    description: 'Whether the technician was notified',
    optional: true,
  },
  mark_first_response: {
    type: 'boolean',
    description: 'Whether the note counts as the first response',
    optional: true,
  },
  add_to_linked_requests: {
    type: 'boolean',
    description: 'Whether the note was copied to linked requests',
    optional: true,
  },
  created_time: {
    type: 'json',
    description: 'Creation time',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  created_by: {
    type: 'json',
    description: 'Note author',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  request: {
    type: 'json',
    description: 'The request the note belongs to',
    optional: true,
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Request ID', optional: true },
      display_id: { type: 'string', description: 'Request number', optional: true },
      subject: { type: 'string', description: 'Request subject', optional: true },
    },
  },
}

/**
 * Verified against the Get / Get List response samples on
 * https://www.manageengine.com/products/service-desk/sdpod-v3-api/problems/problem.html.
 * `display_id` is a `{ display_value, value }` pair on problems and changes,
 * unlike the plain string it is on requests.
 */
export const SDP_PROBLEM_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Problem ID' },
  display_id: {
    type: 'json',
    description: 'Problem number shown in the SDP UI',
    optional: true,
    nullable: true,
    properties: DISPLAY_ID_PROPERTIES,
  },
  title: { type: 'string', description: 'Problem title', optional: true },
  description: {
    type: 'string',
    description: 'Problem description (HTML)',
    optional: true,
    nullable: true,
  },
  status: {
    type: 'json',
    description: 'Current status',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  priority: {
    type: 'json',
    description: 'Priority',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  urgency: {
    type: 'json',
    description: 'Urgency',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  impact: {
    type: 'json',
    description: 'Impact',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  category: {
    type: 'json',
    description: 'Category',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  subcategory: {
    type: 'json',
    description: 'Subcategory',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  group: {
    type: 'json',
    description: 'Support group',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  site: {
    type: 'json',
    description: 'Site',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  reported_by: {
    type: 'json',
    description: 'User who reported the problem',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  technician: {
    type: 'json',
    description: 'Assigned technician',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  reported_time: {
    type: 'json',
    description: 'Time the problem was reported',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  due_by_time: {
    type: 'json',
    description: 'Due time',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  closed_time: {
    type: 'json',
    description: 'Time the problem was closed',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  root_cause: {
    type: 'json',
    description: 'Root cause analysis',
    optional: true,
    nullable: true,
  },
  workaround_details: {
    type: 'json',
    description: 'Documented workaround',
    optional: true,
    nullable: true,
  },
  resolution_details: {
    type: 'json',
    description: 'Documented resolution',
    optional: true,
    nullable: true,
  },
  known_error_details: {
    type: 'json',
    description: 'Known-error record details',
    optional: true,
    nullable: true,
  },
  notes_present: { type: 'boolean', description: 'Whether the problem has notes', optional: true },
}

/**
 * Verified against the Get / Get List response samples on
 * https://www.manageengine.com/products/service-desk/sdpod-v3-api/changes/change.html.
 */
export const SDP_CHANGE_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Change ID' },
  display_id: {
    type: 'json',
    description: 'Change number shown in the SDP UI',
    optional: true,
    nullable: true,
    properties: DISPLAY_ID_PROPERTIES,
  },
  title: { type: 'string', description: 'Change title', optional: true },
  description: {
    type: 'string',
    description: 'Change description (HTML)',
    optional: true,
    nullable: true,
  },
  status: {
    type: 'json',
    description: 'Current status',
    optional: true,
    nullable: true,
    properties: {
      ...LOOKUP_PROPERTIES,
      internal_name: { type: 'string', description: 'Internal status name', optional: true },
      stage: { type: 'json', description: 'Change stage', optional: true, nullable: true },
    },
  },
  change_type: {
    type: 'json',
    description: 'Change type',
    optional: true,
    nullable: true,
    properties: {
      ...LOOKUP_PROPERTIES,
      color: { type: 'string', description: 'Type colour', optional: true },
      pre_approved: {
        type: 'boolean',
        description: 'Whether the type is pre-approved',
        optional: true,
      },
    },
  },
  priority: {
    type: 'json',
    description: 'Priority',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  urgency: {
    type: 'json',
    description: 'Urgency',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  impact: {
    type: 'json',
    description: 'Impact',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  approval_status: {
    type: 'json',
    description: 'Approval status',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  reason_for_change: {
    type: 'json',
    description: 'Reason for the change',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  change_requester: {
    type: 'json',
    description: 'User who requested the change',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  change_owner: {
    type: 'json',
    description: 'Change owner',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  change_manager: {
    type: 'json',
    description: 'Change manager',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  group: {
    type: 'json',
    description: 'Support group',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  emergency: { type: 'boolean', description: 'Whether the change is an emergency', optional: true },
  created_time: {
    type: 'json',
    description: 'Creation time',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  scheduled_start_time: {
    type: 'json',
    description: 'Scheduled start',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  scheduled_end_time: {
    type: 'json',
    description: 'Scheduled end',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  roll_out_plan: {
    type: 'json',
    description: 'Roll-out plan',
    optional: true,
    nullable: true,
  },
  close_details: {
    type: 'json',
    description: 'Closure details',
    optional: true,
    nullable: true,
  },
}

/**
 * Verified against the Get / Get List response samples on
 * https://www.manageengine.com/products/service-desk/sdpod-v3-api/assets/asset.html.
 */
export const SDP_ASSET_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Asset ID' },
  name: { type: 'string', description: 'Asset name', optional: true },
  asset_tag: { type: 'string', description: 'Asset tag', optional: true, nullable: true },
  barcode: { type: 'string', description: 'Barcode', optional: true, nullable: true },
  serial_number: { type: 'string', description: 'Serial number', optional: true, nullable: true },
  ip_address: { type: 'string', description: 'IP address', optional: true, nullable: true },
  mac_address: { type: 'string', description: 'MAC address', optional: true, nullable: true },
  location: { type: 'string', description: 'Location', optional: true, nullable: true },
  state: {
    type: 'json',
    description: 'Asset state (In Use, In Store, ...)',
    optional: true,
    nullable: true,
    properties: {
      ...LOOKUP_PROPERTIES,
      description: { type: 'string', description: 'State description', optional: true },
    },
  },
  product: {
    type: 'json',
    description: 'Product this asset is an instance of',
    optional: true,
    nullable: true,
    properties: {
      ...LOOKUP_PROPERTIES,
      manufacturer: { type: 'string', description: 'Manufacturer', optional: true },
      part_no: { type: 'string', description: 'Part number', optional: true },
    },
  },
  product_type: {
    type: 'json',
    description: 'Product type',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  vendor: {
    type: 'json',
    description: 'Vendor',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  department: {
    type: 'json',
    description: 'Owning department',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  site: {
    type: 'json',
    description: 'Site',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  user: {
    type: 'json',
    description: 'User the asset is assigned to',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  purchase_cost: { type: 'number', description: 'Purchase cost', optional: true, nullable: true },
  total_cost: { type: 'number', description: 'Total cost', optional: true, nullable: true },
  acquisition_date: {
    type: 'json',
    description: 'Acquisition date',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  expiry_date: {
    type: 'json',
    description: 'Expiry date',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  warranty_expiry: {
    type: 'json',
    description: 'Warranty expiry date',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  is_loaned: { type: 'boolean', description: 'Whether the asset is on loan', optional: true },
  is_in_contract: {
    type: 'boolean',
    description: 'Whether the asset is covered by a contract',
    optional: true,
  },
}

/**
 * `list_info` echoed back on every GET-list response. Documented at
 * https://www.manageengine.com/products/service-desk/sdpod-v3-api/getting-started/input-data.html:
 * `total_count` is only present when the request asked for it via
 * `get_total_count`.
 */
export const SDP_LIST_INFO_PROPERTIES: Record<string, ToolOutputProperty> = {
  row_count: { type: 'number', description: 'Rows returned', optional: true },
  start_index: { type: 'number', description: 'Index the page started at', optional: true },
  page: { type: 'number', description: 'Page number', optional: true },
  has_more_rows: {
    type: 'boolean',
    description: 'Whether more rows are available after this page',
    optional: true,
  },
  sort_field: { type: 'string', description: 'Field the results were sorted on', optional: true },
  sort_order: { type: 'string', description: 'Sort direction', optional: true },
  total_count: {
    type: 'number',
    description: 'Total matching rows, present only when get_total_count was requested',
    optional: true,
  },
}

/**
 * Verified against the Add / Get / Get List response samples on
 * https://www.manageengine.com/products/service-desk/sdpod-v3-api/solution/solution.html.
 */
export const SDP_SOLUTION_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Solution ID' },
  display_id: {
    type: 'json',
    description: 'Solution number shown in the SDP UI',
    optional: true,
    nullable: true,
    properties: DISPLAY_ID_PROPERTIES,
  },
  title: { type: 'string', description: 'Solution title', optional: true },
  description: {
    type: 'string',
    description: 'Solution body (HTML)',
    optional: true,
    nullable: true,
  },
  topic: {
    type: 'json',
    description: 'Topic the solution is filed under',
    optional: true,
    nullable: true,
    properties: {
      ...LOOKUP_PROPERTIES,
      parent_topic: { type: 'json', description: 'Parent topic', optional: true, nullable: true },
    },
  },
  approval_status: {
    type: 'json',
    description: 'Approval status',
    optional: true,
    nullable: true,
    properties: LOOKUP_PROPERTIES,
  },
  keywords: { type: 'string', description: 'Search keywords', optional: true, nullable: true },
  is_public: {
    type: 'boolean',
    description: 'Whether requesters can see the solution',
    optional: true,
  },
  likes: { type: 'number', description: 'Like count', optional: true },
  dislikes: { type: 'number', description: 'Dislike count', optional: true },
  no_of_hits: { type: 'number', description: 'View count', optional: true },
  created_time: {
    type: 'json',
    description: 'Creation time',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  last_updated_time: {
    type: 'json',
    description: 'Last update time',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  review_date: {
    type: 'json',
    description: 'Date the solution is due for review',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  expiry_date: {
    type: 'json',
    description: 'Date the solution expires',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
  created_by: {
    type: 'json',
    description: 'Author',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  last_updated_by: {
    type: 'json',
    description: 'User who last updated the solution',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  udf_fields: {
    type: 'json',
    description: 'Portal-defined custom fields',
    optional: true,
    nullable: true,
  },
}

/**
 * Problem and change notes, verified against the Add / Get / Get List samples on
 * https://www.manageengine.com/products/service-desk/sdpod-v3-api/problems/problem_note.html
 * and .../changes/change_note.html.
 *
 * Deliberately NOT shared with {@link SDP_REQUEST_NOTE_PROPERTIES}: a request
 * note carries `created_by` / `created_time` plus visibility flags, while these
 * carry `performed_by` / `performed_time` and nothing else. The two modules
 * genuinely disagree, and the singular response key differs too (`note` here,
 * `request_note` there).
 */
export const SDP_MODULE_NOTE_PROPERTIES: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Note ID' },
  description: { type: 'string', description: 'Note body (HTML)', optional: true },
  performed_by: {
    type: 'json',
    description: 'Note author',
    optional: true,
    nullable: true,
    properties: USER_PROPERTIES,
  },
  performed_time: {
    type: 'json',
    description: 'Time the note was added',
    optional: true,
    nullable: true,
    properties: TIME_PROPERTIES,
  },
}
