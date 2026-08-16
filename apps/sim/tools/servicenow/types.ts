import type { ToolResponse } from '@/tools/types'

/**
 * A ServiceNow record as returned by the Table API. With
 * `sysparm_display_value=all` every field is `{ value, display_value }`; with
 * `false` (ServiceNow's default) reference fields are `{ value, link }` and
 * everything else is a raw string.
 */
export interface ServiceNowRecord {
  sys_id?: unknown
  number?: unknown
  [key: string]: unknown
}

/**
 * The envelope every ServiceNow REST endpoint replies with. Success bodies
 * carry `result` — an object for single-record endpoints, an array for
 * collections; failures carry `error`. `result` stays `unknown` so each tool
 * narrows it deliberately rather than inheriting an unchecked shape.
 */
export interface ServiceNowEnvelope {
  result?: unknown
  error?: { message?: string; detail?: string } | string
}

/** Credentials shared by every ServiceNow tool. */
export interface ServiceNowAuthParams {
  instanceUrl: string
  username: string
  password: string
}

interface ServiceNowBaseParams extends ServiceNowAuthParams {
  tableName: string
}

/** Table API read parameters shared by every semantic list/get tool. */
export interface ServiceNowReadOptions {
  query?: string
  limit?: number
  offset?: number
  fields?: string
  displayValue?: string
}

/** Table API write parameters shared by every semantic create/update tool. */
export interface ServiceNowWriteOptions {
  fields?: string
  displayValue?: string
  inputDisplayValue?: boolean | string
}

/** Standard list-shaped output for the semantic tools. */
export interface ServiceNowRecordListResponse extends ToolResponse {
  output: {
    records: ServiceNowRecord[]
    metadata: {
      recordCount: number
    }
  }
}

/** Standard single-record output for the semantic tools. */
export interface ServiceNowSingleRecordResponse extends ToolResponse {
  output: {
    record: ServiceNowRecord | null
    metadata: {
      recordCount: number
    }
  }
}

export interface ServiceNowCreateIncidentParams
  extends ServiceNowAuthParams,
    ServiceNowWriteOptions {
  shortDescription: string
  description?: string
  callerId?: string
  category?: string
  subcategory?: string
  impact?: string
  urgency?: string
  priority?: string
  state?: string
  assignmentGroup?: string
  assignedTo?: string
  cmdbCi?: string
  businessService?: string
  contactType?: string
  workNotes?: string
  comments?: string
  additionalFields?: Record<string, unknown> | string
}

export interface ServiceNowGetIncidentParams extends ServiceNowAuthParams {
  sysId?: string
  number?: string
  fields?: string
  displayValue?: string
}

export interface ServiceNowListIncidentsParams extends ServiceNowAuthParams, ServiceNowReadOptions {
  state?: string
  priority?: string
  assignmentGroup?: string
  assignedTo?: string
  callerId?: string
  active?: string
  searchText?: string
}

export interface ServiceNowUpdateIncidentParams
  extends ServiceNowAuthParams,
    ServiceNowWriteOptions {
  sysId?: string
  shortDescription?: string
  description?: string
  state?: string
  impact?: string
  urgency?: string
  priority?: string
  category?: string
  subcategory?: string
  assignmentGroup?: string
  assignedTo?: string
  cmdbCi?: string
  workNotes?: string
  comments?: string
  additionalFields?: Record<string, unknown> | string
}

export interface ServiceNowResolveIncidentParams
  extends ServiceNowAuthParams,
    ServiceNowWriteOptions {
  sysId?: string
  closeCode: string
  closeNotes: string
  workNotes?: string
  additionalFields?: Record<string, unknown> | string
}

export interface ServiceNowAddCommentParams extends ServiceNowAuthParams, ServiceNowWriteOptions {
  sysId?: string
  commentField?: string
  comment: string
}

export interface ServiceNowCreateChangeParams extends ServiceNowAuthParams, ServiceNowWriteOptions {
  shortDescription: string
  description?: string
  type?: string
  category?: string
  risk?: string
  impact?: string
  priority?: string
  assignmentGroup?: string
  assignedTo?: string
  requestedBy?: string
  cmdbCi?: string
  startDate?: string
  endDate?: string
  justification?: string
  implementationPlan?: string
  backoutPlan?: string
  testPlan?: string
  additionalFields?: Record<string, unknown> | string
}

export interface ServiceNowGetChangeParams extends ServiceNowAuthParams {
  sysId?: string
  number?: string
  fields?: string
  displayValue?: string
}

export interface ServiceNowListChangesParams extends ServiceNowAuthParams, ServiceNowReadOptions {
  state?: string
  type?: string
  risk?: string
  assignmentGroup?: string
  assignedTo?: string
  active?: string
  searchText?: string
}

export interface ServiceNowUpdateChangeParams extends ServiceNowAuthParams, ServiceNowWriteOptions {
  sysId?: string
  shortDescription?: string
  description?: string
  state?: string
  risk?: string
  impact?: string
  priority?: string
  assignmentGroup?: string
  assignedTo?: string
  startDate?: string
  endDate?: string
  closeCode?: string
  closeNotes?: string
  workNotes?: string
  additionalFields?: Record<string, unknown> | string
}

export interface ServiceNowChangeStateParams extends ServiceNowAuthParams, ServiceNowWriteOptions {
  sysId?: string
  state: string
  closeCode?: string
  closeNotes?: string
  workNotes?: string
  additionalFields?: Record<string, unknown> | string
}

export interface ServiceNowListChangeTasksParams extends ServiceNowAuthParams {
  changeSysId: string
  query?: string
  limit?: number
  offset?: number
  order?: string
}

export interface ServiceNowChangeTaskListResponse extends ToolResponse {
  output: {
    tasks: ServiceNowRecord[]
    metadata: {
      recordCount: number
    }
  }
}

export interface ServiceNowGetChangeNextStatesParams extends ServiceNowAuthParams {
  changeSysId: string
}

export interface ServiceNowGetChangeNextStatesResponse extends ToolResponse {
  output: {
    availableStates: string[]
    allowedStates: string[]
    stateLabels: Record<string, string>
    /**
     * Transitions are passed through verbatim once flattened. The Change
     * Management API documents each as `{ sys_id, display_value, from_state,
     * to_state, transition_available, automatic_transition, conditions[] }`, but
     * only the outer object shape is verified at runtime, so the type stays as
     * the raw record it actually is.
     */
    stateTransitions: ServiceNowRecord[]
    metadata: {
      transitionCount: number
    }
  }
}

export interface ServiceNowListCatalogItemsParams extends ServiceNowAuthParams {
  searchText?: string
  catalogSysId?: string
  categorySysId?: string
  limit?: number
  offset?: number
}

export interface ServiceNowCatalogItem {
  sys_id?: string
  name?: string
  short_description?: string | null
  description?: string
  type?: string
  sys_class_name?: string
  category?: { sys_id?: string; title?: string } | null
  catalogs?: Array<{ sys_id?: string; title?: string }>
  price?: string
  show_price?: boolean
  picture?: string
  icon?: string
  order?: number
  [key: string]: unknown
}

export interface ServiceNowListCatalogItemsResponse extends ToolResponse {
  output: {
    items: ServiceNowCatalogItem[]
    metadata: {
      recordCount: number
    }
  }
}

export interface ServiceNowOrderCatalogItemParams extends ServiceNowAuthParams {
  catalogItemSysId: string
  quantity?: number
  requestedFor?: string
  variables?: Record<string, unknown> | string
}

export interface ServiceNowOrderCatalogItemResponse extends ToolResponse {
  output: {
    sysId: string | null
    number: string | null
    requestNumber: string | null
    requestId: string | null
    table: string | null
  }
}

export interface ServiceNowListRequestedItemsParams
  extends ServiceNowAuthParams,
    ServiceNowReadOptions {
  requestSysId?: string
  catalogItemSysId?: string
  active?: string
}

export interface ServiceNowGetRequestedItemParams extends ServiceNowAuthParams {
  sysId?: string
  number?: string
  fields?: string
  displayValue?: string
}

export interface ServiceNowListApprovalsParams extends ServiceNowAuthParams, ServiceNowReadOptions {
  approverSysId?: string
  state?: string
  approvalFor?: string
}

export interface ServiceNowUpdateApprovalParams
  extends ServiceNowAuthParams,
    ServiceNowWriteOptions {
  approvalSysId: string
  decision: string
  comments?: string
}

export interface ServiceNowSearchCisParams extends ServiceNowAuthParams, ServiceNowReadOptions {
  ciClass?: string
  name?: string
  operationalStatus?: string
}

export interface ServiceNowGetCiParams extends ServiceNowAuthParams {
  ciClass: string
  sysId: string
}

export interface ServiceNowGetCiResponse extends ToolResponse {
  output: {
    attributes: Record<string, unknown> | null
    /**
     * Relation entries are passed through verbatim. The CMDB Instance API
     * documents each as `{ sys_id, type: { value, display_value, link },
     * target: { value, display_value, link } }`, but the shape is not verified
     * at runtime, so the type stays as the raw record it actually is.
     */
    inboundRelations: ServiceNowRecord[]
    outboundRelations: ServiceNowRecord[]
    metadata: {
      inboundCount: number
      outboundCount: number
    }
  }
}

export interface ServiceNowListCiRelationshipsParams
  extends ServiceNowAuthParams,
    ServiceNowReadOptions {
  ciSysId: string
  direction?: string
}

export interface ServiceNowSearchKnowledgeParams extends ServiceNowAuthParams {
  query?: string
  filter?: string
  knowledgeBaseSysIds?: string
  language?: string
  fields?: string
  limit?: number
  offset?: number
}

export interface ServiceNowSearchKnowledgeResponse extends ToolResponse {
  output: {
    /**
     * Articles are passed through verbatim. The Knowledge Management API
     * documents each as `{ id, number, title, snippet, link, score, rank,
     * fields }`, but only the outer object shape is verified at runtime, so the
     * type stays as the raw record it actually is.
     */
    articles: ServiceNowRecord[]
    metadata: {
      recordCount: number
      totalCount: number | null
    }
  }
}

export interface ServiceNowGetKnowledgeArticleParams extends ServiceNowAuthParams {
  articleId: string
  fields?: string
  language?: string
  updateView?: boolean | string
}

export interface ServiceNowGetKnowledgeArticleResponse extends ToolResponse {
  output: {
    sysId: string | null
    number: string | null
    title: string | null
    content: string | null
    fields: Record<string, unknown> | null
    attachments: Array<Record<string, unknown>>
  }
}

export interface ServiceNowFindUserParams extends ServiceNowAuthParams, ServiceNowReadOptions {
  email?: string
  userName?: string
  name?: string
  active?: string
}

export interface ServiceNowListGroupMembersParams
  extends ServiceNowAuthParams,
    ServiceNowReadOptions {
  groupSysId?: string
  groupName?: string
}

export interface ServiceNowCreateParams extends ServiceNowBaseParams {
  fields: Record<string, unknown>
}

export interface ServiceNowCreateResponse extends ToolResponse {
  output: {
    record: ServiceNowRecord
    metadata: {
      recordCount: 1
    }
  }
}

export interface ServiceNowReadParams extends ServiceNowBaseParams {
  sysId?: string
  number?: string
  query?: string
  limit?: number
  offset?: number
  fields?: string
  displayValue?: string
}

export interface ServiceNowReadResponse extends ToolResponse {
  output: {
    records: ServiceNowRecord[]
    metadata: {
      recordCount: number
    }
  }
}

export interface ServiceNowUpdateParams extends ServiceNowBaseParams {
  sysId: string
  fields: Record<string, unknown>
}

export interface ServiceNowUpdateResponse extends ToolResponse {
  output: {
    record: ServiceNowRecord
    metadata: {
      recordCount: 1
      updatedFields: string[]
    }
  }
}

export interface ServiceNowDeleteParams extends ServiceNowBaseParams {
  sysId: string
}

export interface ServiceNowDeleteResponse extends ToolResponse {
  output: {
    success: boolean
    metadata: {
      deletedSysId: string
    }
  }
}

export interface ServiceNowAggregateParams extends ServiceNowBaseParams {
  query?: string
  count?: boolean
  groupBy?: string
  avgFields?: string
  sumFields?: string
  minFields?: string
  maxFields?: string
  having?: string
  displayValue?: string
}

export interface ServiceNowAggregateResponse extends ToolResponse {
  output: {
    result: Record<string, unknown> | Record<string, unknown>[] | null
    count: number | null
    metadata: {
      grouped: boolean
      groupCount: number | null
    }
  }
}

export interface ServiceNowAttachment {
  sys_id: string
  file_name: string
  content_type: string
  size_bytes?: string
  table_name?: string
  table_sys_id?: string
  download_link?: string
  [key: string]: unknown
}

export interface ServiceNowListAttachmentsParams {
  instanceUrl: string
  username: string
  password: string
  tableName: string
  recordSysId: string
  limit?: number
}

export interface ServiceNowListAttachmentsResponse extends ToolResponse {
  output: {
    attachments: ServiceNowAttachment[]
    metadata: {
      recordCount: number
    }
  }
}

export interface ServiceNowDownloadAttachmentParams {
  instanceUrl: string
  username: string
  password: string
  attachmentSysId: string
}

export interface ServiceNowDownloadAttachmentResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: string
      size: number
    }
    content: string
  }
}

export interface ServiceNowUploadAttachmentParams {
  instanceUrl: string
  username: string
  password: string
  tableName: string
  recordSysId: string
  fileName: string
  file?: unknown
}

export interface ServiceNowUploadAttachmentResponse extends ToolResponse {
  output: {
    attachment: ServiceNowAttachment
    metadata: {
      recordCount: 1
    }
  }
}

export type ServiceNowResponse =
  | ServiceNowCreateResponse
  | ServiceNowReadResponse
  | ServiceNowUpdateResponse
  | ServiceNowDeleteResponse
  | ServiceNowAggregateResponse
  | ServiceNowListAttachmentsResponse
  | ServiceNowDownloadAttachmentResponse
  | ServiceNowUploadAttachmentResponse
  | ServiceNowRecordListResponse
  | ServiceNowSingleRecordResponse
  | ServiceNowChangeTaskListResponse
  | ServiceNowGetChangeNextStatesResponse
  | ServiceNowListCatalogItemsResponse
  | ServiceNowOrderCatalogItemResponse
  | ServiceNowGetCiResponse
  | ServiceNowSearchKnowledgeResponse
  | ServiceNowGetKnowledgeArticleResponse
