import type { z } from 'zod'
import type * as schemas from '@/tools/plane/schemas'
import type { PlanePagination } from '@/tools/plane/utils'
import type { ToolResponse } from '@/tools/types'

interface PlaneCredentials {
  apiKey: string
  baseUrl?: string
  apiVersion?: 'v1' | 'v2'
}

export interface PlaneArchiveProjectParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
}
export interface PlaneArchiveProjectResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneArchiveWorkItemParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneArchiveWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItems50747fSchema> }
}

export interface PlaneConfirmAttachmentUploadParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  is_uploaded?: boolean | null
  fields?: string
}
export interface PlaneConfirmAttachmentUploadResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2WorkItemAttachmentsee0dadSchema> }
    | { success: boolean }
}

export interface PlaneCreateAttachmentUploadParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  name: string
  size: number
  external_id?: string | null
  external_source?: string | null
  type?: string | null
  fields?: string
}
export interface PlaneCreateAttachmentUploadResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemAttachments95c9d1Schema> }
}

export interface PlaneCreateCommentParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  comment_html?: string | null
  access?: string | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  expand?: string
  comment_json?: Record<string, unknown> | string | null
  created_at?: string | null
  created_by?: string | null
}
export interface PlaneCreateCommentResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemComments5af051Schema> }
}

export interface PlaneCreateCycleParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  description?: string | null
  start_date?: string | null
  end_date?: string | null
  timezone?: string | null
  sort_order?: number | null
  logo_props?: unknown | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  expand?: string
  owned_by?: string | null
}
export interface PlaneCreateCycleResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Cycles2e33f2Schema> }
}

export interface PlaneCreateLabelParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  color?: string | null
  description?: string | null
  parent_id?: string | null
  sort_order?: number | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
}
export interface PlaneCreateLabelResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Labelseef21eSchema> }
}

export interface PlaneCreateLinkParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  url: string
  metadata?: Record<string, unknown> | string | null
  title?: string | null
  fields?: string
  created_by?: string | null
  issue_id?: string | null
}
export interface PlaneCreateLinkResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemLinksbf8b88Schema> }
}

export interface PlaneCreateModuleParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  description?: string | null
  status?: string | null
  start_date?: string | null
  target_date?: string | null
  lead_id?: string | null
  sort_order?: number | null
  logo_props?: unknown | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  expand?: string
  members?: unknown[] | string | null
}
export interface PlaneCreateModuleResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Modules939f54Schema> }
}

export interface PlaneCreateProjectParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  identifier: string
  name: string
  archive_in?: number | null
  close_in?: number | null
  cover_image?: string | null
  cycle_view?: boolean | null
  default_assignee_id?: string | null
  default_state_id?: string | null
  description?: string | null
  emoji?: string | null
  estimate_id?: string | null
  external_id?: string | null
  external_source?: string | null
  guest_view_all_features?: boolean | null
  icon_prop?: string | null
  intake_view?: boolean | null
  is_issue_type_enabled?: boolean | null
  is_time_tracking_enabled?: boolean | null
  issue_views_view?: boolean | null
  logo_props?: string | null
  module_view?: boolean | null
  network?: string | null
  page_view?: boolean | null
  priority?: string | null
  project_lead_id?: string | null
  start_date?: string | null
  state_id?: string | null
  target_date?: string | null
  timezone?: string | null
  fields?: string
  expand?: string
  v1_icon_prop?: Record<string, unknown> | string | null
}
export interface PlaneCreateProjectResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Projectsfac84fSchema> }
}

export interface PlaneCreateProjectPageParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  access?: string | null
  archived_at?: string | null
  collection_id?: string | null
  color?: string | null
  description_html?: string | null
  external_id?: string | null
  external_source?: string | null
  is_locked?: boolean | null
  logo_props?: string | null
  parent_id?: string | null
  sort_order?: number | null
  view_props?: string | null
  fields?: string
  expand?: string
  v1_access?: number | null
  v1_view_props?: Record<string, unknown> | string | null
  v1_logo_props?: Record<string, unknown> | string | null
}
export interface PlaneCreateProjectPageResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectPages0bb396Schema> }
}

export interface PlaneCreateStateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  color: string
  group?: string | null
  description?: string | null
  sequence?: number | null
  is_default?: boolean | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  is_triage?: boolean | null
  default?: boolean | null
}
export interface PlaneCreateStateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Statesd0d9cbSchema> }
}

export interface PlaneCreateWebhookParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  content_type?: string | null
  is_active?: boolean | null
  name?: string | null
  scopes?: unknown[] | string | null
  url?: string | null
  version?: string | null
  fields?: string
}
export interface PlaneCreateWebhookResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Webhooksbfebf2Schema> }
}

export interface PlaneCreateWorkItemParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  description_html?: string | null
  priority?: string | null
  state_id?: string | null
  state?: string | null
  type_id?: string | null
  type?: string | null
  parent_id?: string | null
  parent?: string | null
  assignee_ids?: unknown[] | string | null
  assignees?: unknown[] | string | null
  label_ids?: unknown[] | string | null
  labels?: unknown[] | string | null
  estimate_point_id?: string | null
  estimate?: string | null
  start_date?: string | null
  target_date?: string | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  expand?: string
  deleted_at?: string | null
  point?: number | null
  sequence_id?: number | null
  sort_order?: number | null
  archived_at?: string | null
  is_draft?: boolean | null
  created_by?: string | null
  created_at?: string | null
  custom_fields?: Record<string, unknown> | string | null
  cycle_id?: string | null
  module_ids?: unknown[] | string | null
}
export interface PlaneCreateWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItems70dceeSchema> }
}

export interface PlaneDeleteAttachmentParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
}
export interface PlaneDeleteAttachmentResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteCommentParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
}
export interface PlaneDeleteCommentResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteCycleParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
}
export interface PlaneDeleteCycleResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteLabelParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
}
export interface PlaneDeleteLabelResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteLinkParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
}
export interface PlaneDeleteLinkResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteModuleParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
}
export interface PlaneDeleteModuleResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteProjectParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
}
export interface PlaneDeleteProjectResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteProjectPageParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
}
export interface PlaneDeleteProjectPageResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteStateParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
}
export interface PlaneDeleteStateResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWebhookParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
}
export interface PlaneDeleteWebhookResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkItemParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
}
export interface PlaneDeleteWorkItemResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneGetAttachmentParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  fields?: string
}
export interface PlaneGetAttachmentResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemAttachmentsee0dadSchema> }
}

export interface PlaneGetCommentParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetCommentResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemComments5af051Schema> }
}

export interface PlaneGetCurrentUserParams extends PlaneCredentials {}
export interface PlaneGetCurrentUserResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2GetCurrentUserresultbff3bfSchema> }
}

export interface PlaneGetCycleParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetCycleResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Cycles2e33f2Schema> }
}

export interface PlaneGetLabelParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneGetLabelResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Labelseef21eSchema> }
}

export interface PlaneGetLinkParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  fields?: string
  cursor?: string
  expand?: string
  per_page?: number
}
export interface PlaneGetLinkResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemLinks2ed9b8Schema> }
}

export interface PlaneGetModuleParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetModuleResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Modules939f54Schema> }
}

export interface PlaneGetProjectParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetProjectResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Projectsfac84fSchema> }
}

export interface PlaneGetProjectPageParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
  external_id?: string
  external_source?: string
  order_by?: string
}
export interface PlaneGetProjectPageResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectPages728fd0Schema> }
}

export interface PlaneGetProjectSummaryParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  counts?: string
  fields?: string
}
export interface PlaneGetProjectSummaryResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2GetProjectSummaryresultSchema> }
}

export interface PlaneGetStateParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneGetStateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Statesd0d9cbSchema> }
}

export interface PlaneGetWebhookParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetWebhookResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Webhooksa201e9Schema> }
}

export interface PlaneGetWorkItemParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  expand?: string
  fields?: string
  external_id?: string
  external_source?: string
  order_by?: string
}
export interface PlaneGetWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItems6d2e4eSchema> }
}

export interface PlaneGetWorkItemByIdentifierParams extends PlaneCredentials {
  workspace_slug: string
  identifier: string
  expand?: string
  fields?: string
}
export interface PlaneGetWorkItemByIdentifierResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItems5a99d3Schema> }
}

export interface PlaneListAttachmentsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  count?: boolean
  external_id?: string
  external_source?: string
  is_uploaded?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  fields?: string
  cursor?: string
}
export interface PlaneListAttachmentsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListAttachmentsresultSchema> }
    | { results: z.output<typeof schemas.workItemAttachment28f0baSchema>[]; detail?: string }
}

export interface PlaneListCommentsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  access?: string
  external_id?: string
  external_source?: string
  search?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListCommentsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListCommentsresultSchema> }
    | {
        results: z.output<typeof schemas.workItemCommenta652feSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListCyclesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  owned_by_id?: string
  external_id?: string
  external_source?: string
  search?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  fields?: string
  expand?: string
  cursor?: string
  cycle_view?: string
}
export interface PlaneListCyclesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListCyclesresultSchema> }
    | {
        results: z.output<typeof schemas.cycle857a4cSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListLabelsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  parent_id?: string
  external_id?: string
  external_source?: string
  search?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  fields?: string
  cursor?: string
  expand?: string
}
export interface PlaneListLabelsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListLabelsresultSchema> }
    | {
        results: z.output<typeof schemas.labelb4435fSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListLinksParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  title?: string
  url?: string
  fields?: string
  cursor?: string
  expand?: string
}
export interface PlaneListLinksResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListLinksresultSchema> }
    | {
        results: z.output<typeof schemas.workItemLink43e0b0Schema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListModulesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  status?: string
  lead_id?: string
  external_id?: string
  external_source?: string
  search?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  fields?: string
  status__in?: string
  expand?: string
  cursor?: string
}
export interface PlaneListModulesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListModulesresultSchema> }
    | {
        results: z.output<typeof schemas.moduleb27e64Schema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListProjectPagesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  access?: number
  collection_id?: string
  count?: boolean
  external_id?: string
  external_source?: string
  is_global?: boolean
  is_locked?: boolean
  offset?: number
  order_by?: string
  owned_by_id?: string
  paginate?: string
  parent_id?: string
  per_page?: number
  search?: string
  type?: string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListProjectPagesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListProjectPagesresultSchema> }
    | {
        results: z.output<typeof schemas.planePageContentSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListProjectsParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  external_id?: string
  external_source?: string
  identifier?: string
  include_archived?: boolean
  is_archived?: boolean
  key?: string
  name?: string
  network?: number
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  priority?: string
  priority__in?: unknown[] | string
  search?: string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListProjectsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListProjectsresultSchema> }
    | {
        results: z.output<typeof schemas.project26b734Schema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListStatesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  group?: string
  is_default?: boolean
  external_id?: string
  external_source?: string
  search?: string
  fields?: string
  group__in?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
  expand?: string
}
export interface PlaneListStatesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListStatesresultSchema> }
    | {
        results: z.output<typeof schemas.state4b88aeSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListWebhooksParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  is_active?: boolean
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  url?: string
  fields?: string
  cursor?: string
}
export interface PlaneListWebhooksResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWebhooksresultSchema> }
}

export interface PlaneListWorkItemsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  fields?: string
  state_id?: string
  state_id__in?: string
  state_group?: string
  state_group__in?: string
  priority?: string
  priority__in?: string
  assignee_id?: string
  assignee_id__in?: string
  label_id?: string
  label_id__in?: string
  type_id?: string
  type_id__in?: string
  parent_id?: string
  parent_id__in?: string
  cycle_id?: string
  cycle_id__in?: string
  module_id?: string
  module_id__in?: string
  sequence_id?: number
  is_draft?: boolean
  external_id?: string
  external_source?: string
  created_at__gte?: string
  created_at__lte?: string
  updated_at__gte?: string
  updated_at__lte?: string
  start_date__gte?: string
  start_date__lte?: string
  target_date__gte?: string
  target_date__lte?: string
  search?: string
  order_by?: string
  per_page?: number
  offset?: number
  count?: boolean
  paginate?: string
  expand?: string
  cursor?: string
  pql?: string
  filters?: Record<string, unknown> | string
}
export interface PlaneListWorkItemsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListWorkItemsresultSchema> }
    | {
        results: z.output<typeof schemas.workItemdc8a1dSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListWorkspaceWorkItemsParams extends PlaneCredentials {
  workspace_slug: string
  assignee_id?: string
  assignee_id__in?: unknown[] | string
  assignee_id__isnull?: boolean
  count?: boolean
  created_at__gte?: string
  created_at__lte?: string
  cycle_id?: string
  cycle_id__in?: unknown[] | string
  cycle_id__isnull?: boolean
  external_id?: string
  external_source?: string
  is_draft?: boolean
  label_id?: string
  label_id__in?: unknown[] | string
  label_id__isnull?: boolean
  module_id?: string
  module_id__in?: unknown[] | string
  module_id__isnull?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  parent_id?: string
  parent_id__in?: unknown[] | string
  parent_id__isnull?: boolean
  per_page?: number
  priority?: string
  priority__in?: unknown[] | string
  project_id?: string
  project_id__in?: unknown[] | string
  search?: string
  sequence_id?: number
  start_date__gte?: string
  start_date__lte?: string
  state_group?: string
  state_group__in?: unknown[] | string
  state_id?: string
  state_id__in?: unknown[] | string
  target_date__gte?: string
  target_date__lte?: string
  type_id?: string
  type_id__in?: unknown[] | string
  updated_at__gte?: string
  updated_at__lte?: string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListWorkspaceWorkItemsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkspaceWorkItemsresultSchema> }
}

export interface PlaneManageCycleWorkItemsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  add?: unknown[] | string | null
  remove?: unknown[] | string | null
}
export interface PlaneManageCycleWorkItemsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ManageCycleWorkItemsresultSchema> }
    | { results: z.output<typeof schemas.cycleWorkItem52a223Schema>[]; detail?: string }
    | { success: boolean }
}

export interface PlaneManageModuleWorkItemsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  add?: unknown[] | string | null
  remove?: unknown[] | string | null
}
export interface PlaneManageModuleWorkItemsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ManageModuleWorkItemsresultSchema> }
    | { results: z.output<typeof schemas.moduleWorkItema652d3Schema>[]; detail?: string }
    | { success: boolean }
}

export interface PlaneRegenerateWebhookSecretParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneRegenerateWebhookSecretResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2RegenerateWebhookSecretresultSchema> }
}

export interface PlaneTransferCycleWorkItemsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  new_cycle_id: string
}
export interface PlaneTransferCycleWorkItemsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2TransferCycleWorkItemsresultdf206aSchema> }
}

export interface PlaneUnarchiveProjectParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
}
export interface PlaneUnarchiveProjectResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneUnarchiveWorkItemParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneUnarchiveWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemsfdc2fcSchema> }
}

export interface PlaneUpdateCommentParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  comment_html?: string | null
  access?: string | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  expand?: string
  comment_json?: Record<string, unknown> | string | null
}
export interface PlaneUpdateCommentResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemComments5af051Schema> }
}

export interface PlaneUpdateCycleParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  name?: string | null
  description?: string | null
  start_date?: string | null
  end_date?: string | null
  timezone?: string | null
  sort_order?: number | null
  logo_props?: unknown | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  expand?: string
  owned_by?: string | null
}
export interface PlaneUpdateCycleResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Cycles2e33f2Schema> }
}

export interface PlaneUpdateLabelParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  name?: string | null
  color?: string | null
  description?: string | null
  parent_id?: string | null
  sort_order?: number | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
}
export interface PlaneUpdateLabelResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Labelseef21eSchema> }
}

export interface PlaneUpdateLinkParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  metadata?: Record<string, unknown> | string | null
  title?: string | null
  url?: string | null
  fields?: string
  issue_id?: string | null
}
export interface PlaneUpdateLinkResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemLinks38dcf4Schema> }
}

export interface PlaneUpdateModuleParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  name?: string | null
  description?: string | null
  status?: string | null
  start_date?: string | null
  target_date?: string | null
  lead_id?: string | null
  sort_order?: number | null
  logo_props?: unknown | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  expand?: string
  members?: unknown[] | string | null
}
export interface PlaneUpdateModuleResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Modules939f54Schema> }
}

export interface PlaneUpdateProjectParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  archive_in?: number | null
  close_in?: number | null
  cover_image?: string | null
  cycle_view?: boolean | null
  default_assignee_id?: string | null
  default_state_id?: string | null
  description?: string | null
  emoji?: string | null
  estimate_id?: string | null
  external_id?: string | null
  external_source?: string | null
  guest_view_all_features?: boolean | null
  icon_prop?: string | null
  identifier?: string | null
  intake_view?: boolean | null
  is_issue_type_enabled?: boolean | null
  is_time_tracking_enabled?: boolean | null
  issue_views_view?: boolean | null
  logo_props?: string | null
  module_view?: boolean | null
  name?: string | null
  network?: string | null
  page_view?: boolean | null
  priority?: string | null
  project_lead_id?: string | null
  start_date?: string | null
  state_id?: string | null
  target_date?: string | null
  timezone?: string | null
  fields?: string
  expand?: string
  v1_icon_prop?: Record<string, unknown> | string | null
}
export interface PlaneUpdateProjectResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Projectsfac84fSchema> }
}

export interface PlaneUpdateProjectPageParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  access?: string | null
  archived_at?: string | null
  collection_id?: string | null
  color?: string | null
  description_html?: string | null
  external_id?: string | null
  external_source?: string | null
  is_locked?: boolean | null
  logo_props?: string | null
  name?: string | null
  parent_id?: string | null
  sort_order?: number | null
  view_props?: string | null
  fields?: string
  expand?: string
  v1_access?: number | null
  v1_view_props?: Record<string, unknown> | string | null
  v1_logo_props?: Record<string, unknown> | string | null
}
export interface PlaneUpdateProjectPageResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectPages728fd0Schema> }
}

export interface PlaneUpdateStateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  name?: string | null
  color?: string | null
  description?: string | null
  group?: string | null
  sequence?: number | null
  is_default?: boolean | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  is_triage?: boolean | null
  default?: boolean | null
}
export interface PlaneUpdateStateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Statesd0d9cbSchema> }
}

export interface PlaneUpdateWebhookParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  content_type?: string | null
  is_active?: boolean | null
  name?: string | null
  scopes?: unknown[] | string | null
  url?: string | null
  version?: string | null
  fields?: string
}
export interface PlaneUpdateWebhookResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Webhooksa201e9Schema> }
}

export interface PlaneUpdateWorkItemParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  name?: string | null
  description_html?: string | null
  priority?: string | null
  state_id?: string | null
  state?: string | null
  type_id?: string | null
  type?: string | null
  parent_id?: string | null
  parent?: string | null
  assignee_ids?: unknown[] | string | null
  assignees?: unknown[] | string | null
  label_ids?: unknown[] | string | null
  labels?: unknown[] | string | null
  estimate_point_id?: string | null
  estimate?: string | null
  start_date?: string | null
  target_date?: string | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  expand?: string
  deleted_at?: string | null
  point?: number | null
  sequence_id?: number | null
  sort_order?: number | null
  archived_at?: string | null
  is_draft?: boolean | null
  created_by?: string | null
  custom_fields?: Record<string, unknown> | string | null
  cycle_id?: string | null
  module_ids?: unknown[] | string | null
}
export interface PlaneUpdateWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItems70dceeSchema> }
}
