import type { z } from 'zod'
import type * as schemas from '@/tools/plane/schemas'
import type { PlanePagination } from '@/tools/plane/utils'
import type { ToolResponse } from '@/tools/types'

interface PlaneCredentials {
  apiKey: string
  baseUrl?: string
  apiVersion?: 'v1' | 'v2'
}

export interface PlaneDownloadedFile {
  name: string
  mimeType: string
  data: Buffer
  size: number
}

export interface PlaneArchiveCycleParams extends PlaneCredentials {
  cycle_id: string
  project_id: string
  workspace_slug: string
}
export interface PlaneArchiveCycleResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneArchiveModuleParams extends PlaneCredentials {
  resource_id: string
  project_id: string
  workspace_slug: string
}
export interface PlaneArchiveModuleResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneArchiveProjectParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
}
export interface PlaneArchiveProjectResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneArchiveProjectPageParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  page_id: string
}
export interface PlaneArchiveProjectPageResponse extends ToolResponse {
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
  output: { result: z.output<typeof schemas.planeV2WorkItems0209d1Schema> }
}

export interface PlaneArchiveWorkspacePageParams extends PlaneCredentials {
  workspace_slug: string
  page_id: string
}
export interface PlaneArchiveWorkspacePageResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneAttachTypePropertyParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  type_id: string
  properties: unknown[] | string
}
export interface PlaneAttachTypePropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2AttachTypePropertyresultSchema> }
}

export interface PlaneAttachWorkspaceTypePropertyParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  type_id: string
  properties: unknown[] | string
}
export interface PlaneAttachWorkspaceTypePropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2AttachWorkspaceTypePropertyresultSchema> }
}

export interface PlaneBulkCreateCommentsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkCreateCommentsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkCreateCommentsresultSchema> }
}

export interface PlaneBulkCreateCyclesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkCreateCyclesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkCreateCyclesresultSchema> }
}

export interface PlaneBulkCreateEstimatePointsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  estimate_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkCreateEstimatePointsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkCreateEstimatePointsresultSchema> }
}

export interface PlaneBulkCreateEstimatesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkCreateEstimatesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkCreateEstimatesresultSchema> }
}

export interface PlaneBulkCreateLabelsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkCreateLabelsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkCreateLabelsresultSchema> }
}

export interface PlaneBulkCreateMilestonesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkCreateMilestonesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkCreateMilestonesresultSchema> }
}

export interface PlaneBulkCreateModulesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkCreateModulesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkCreateModulesresultSchema> }
}

export interface PlaneBulkCreateProjectsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkCreateProjectsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkCreateProjectsresultSchema> }
}

export interface PlaneBulkCreateStatesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkCreateStatesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkCreateStatesresultSchema> }
}

export interface PlaneBulkCreateWorkItemsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkCreateWorkItemsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkCreateWorkItemsresultSchema> }
}

export interface PlaneBulkDeleteCommentsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  ids: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkDeleteCommentsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkDeleteCommentsresultSchema> }
}

export interface PlaneBulkDeleteCyclesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  ids: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkDeleteCyclesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkDeleteCyclesresultSchema> }
}

export interface PlaneBulkDeleteEstimatePointsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  estimate_id: string
  ids: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkDeleteEstimatePointsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkDeleteEstimatePointsresultSchema> }
}

export interface PlaneBulkDeleteEstimatesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  ids: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkDeleteEstimatesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkDeleteEstimatesresultSchema> }
}

export interface PlaneBulkDeleteLabelsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  ids: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkDeleteLabelsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkDeleteLabelsresultSchema> }
}

export interface PlaneBulkDeleteMilestonesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  ids: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkDeleteMilestonesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkDeleteMilestonesresultSchema> }
}

export interface PlaneBulkDeleteModulesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  ids: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkDeleteModulesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkDeleteModulesresultSchema> }
}

export interface PlaneBulkDeleteStatesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  ids: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkDeleteStatesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkDeleteStatesresultSchema> }
}

export interface PlaneBulkDeleteWorkItemsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  ids: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkDeleteWorkItemsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkDeleteWorkItemsresultSchema> }
}

export interface PlaneBulkInvitationsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  emails: unknown[] | string
  role?: string | null
  message?: string | null
}
export interface PlaneBulkInvitationsResponse extends ToolResponse {
  output: {
    results: z.output<typeof schemas.planeV2V2BulkInvitationsresultitemSchema>[]
    detail?: string
  }
}

export interface PlaneBulkUpdateCommentsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkUpdateCommentsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkUpdateCommentsresultSchema> }
}

export interface PlaneBulkUpdateCyclesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkUpdateCyclesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkUpdateCyclesresultSchema> }
}

export interface PlaneBulkUpdateEstimatePointsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  estimate_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkUpdateEstimatePointsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkUpdateEstimatePointsresultSchema> }
}

export interface PlaneBulkUpdateEstimatesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkUpdateEstimatesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkUpdateEstimatesresultSchema> }
}

export interface PlaneBulkUpdateLabelsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkUpdateLabelsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkUpdateLabelsresultSchema> }
}

export interface PlaneBulkUpdateMilestonesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkUpdateMilestonesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkUpdateMilestonesresultSchema> }
}

export interface PlaneBulkUpdateModulesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkUpdateModulesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkUpdateModulesresultSchema> }
}

export interface PlaneBulkUpdateProjectsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkUpdateProjectsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkUpdateProjectsresultSchema> }
}

export interface PlaneBulkUpdateStatesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkUpdateStatesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkUpdateStatesresultSchema> }
}

export interface PlaneBulkUpdateWorkItemsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  items: unknown[] | string
  all_or_none?: boolean | null
}
export interface PlaneBulkUpdateWorkItemsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2BulkUpdateWorkItemsresultSchema> }
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
    | { result: z.output<typeof schemas.planeV2WorkItemAttachmentsSchema> }
    | { success: boolean }
}

export interface PlaneConfirmUserAssetParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  pk: string
  fields?: string
  attributes?: Record<string, unknown> | string | null
}
export interface PlaneConfirmUserAssetResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2UserAssetsSchema> } | { success: boolean }
}

export interface PlaneConfirmWorkspaceAssetParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  fields?: string
  is_uploaded?: boolean | null
}
export interface PlaneConfirmWorkspaceAssetResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAssetsSchema> } | { success: boolean }
}

export interface PlaneConfirmWorkspacePageAttachmentUploadParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  page_id: string
  attachment_id: string
  is_uploaded?: boolean | null
}
export interface PlaneConfirmWorkspacePageAttachmentUploadResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneCreateArtifactParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  html: string
  name?: string | null
  description?: string | null
  prompt?: string | null
  project?: string | null
  data_mode?: string | null
}
export interface PlaneCreateArtifactResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ArtifactsSchema> }
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
  output: { result: z.output<typeof schemas.planeV2WorkItemAttachmentse3fe99Schema> }
}

export interface PlaneCreateCollectionParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  access?: string | null
  is_default?: boolean | null
  is_global?: boolean | null
  logo_props?: string | null
  name?: string | null
  sort_order?: number | null
  fields?: string
  expand?: string
  v1_access?: number | null
  v1_logo_props?: Record<string, unknown> | string | null
}
export interface PlaneCreateCollectionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Collections2745f2Schema> }
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
  output: { result: z.output<typeof schemas.planeV2WorkItemComments0c5466Schema> }
}

export interface PlaneCreateCustomerParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  contract_status?: string | null
  description?: string | null
  description_html?: string | null
  domain?: string | null
  email?: string | null
  employees?: number | null
  external_id?: string | null
  external_source?: string | null
  logo_props?: string | null
  revenue?: string | null
  stage?: string | null
  website_url?: string | null
  fields?: string
  v1_description?: Record<string, unknown> | string | null
  description_stripped?: string | null
  v1_logo_props?: Record<string, unknown> | string | null
  archived_at?: string | null
  created_by?: string | null
  updated_by?: string | null
  logo_asset?: string | null
}
export interface PlaneCreateCustomerResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Customers8e07c4Schema> }
}

export interface PlaneCreateCustomerPropertyParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  display_name: string
  property_type: string
  default_value?: unknown[] | string | null
  description?: string | null
  external_id?: string | null
  external_source?: string | null
  is_active?: boolean | null
  is_multi?: boolean | null
  is_required?: boolean | null
  logo_props?: string | null
  options?: unknown[] | string | null
  relation_type?: string | null
  settings?: string | null
  validation_rules?: string | null
  fields?: string
  v1_logo_props?: Record<string, unknown> | string | null
  sort_order?: number | null
  v1_settings?: Record<string, unknown> | string | null
  v1_validation_rules?: Record<string, unknown> | string | null
  created_by?: string | null
  updated_by?: string | null
  name?: string | null
}
export interface PlaneCreateCustomerPropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2CustomerProperties2dc1f6Schema> }
}

export interface PlaneCreateCustomerRequestParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  customer_id: string
  name: string
  description?: string | null
  description_html?: string | null
  link?: string | null
  work_item_ids?: unknown[] | string | null
  fields?: string
  v1_description?: Record<string, unknown> | string | null
}
export interface PlaneCreateCustomerRequestResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2CustomerRequests7999a5Schema> }
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
  output: { result: z.output<typeof schemas.planeV2Cycles6d6772Schema> }
}

export interface PlaneCreateEstimateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  description?: string | null
  external_id?: string | null
  external_source?: string | null
  type?: string | null
  fields?: string
  expand?: string
  last_used?: boolean | null
}
export interface PlaneCreateEstimateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Estimates78fed1Schema> }
}

export interface PlaneCreateEstimatePointParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  estimate_id: string
  value: string
  description?: string | null
  external_id?: string | null
  external_source?: string | null
  key?: number | null
  fields?: string
}
export interface PlaneCreateEstimatePointResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2EstimatePointsSchema> }
}

export interface PlaneCreateInitiativeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  description?: string | null
  description_html?: string | null
  end_date?: string | null
  lead_id?: string | null
  logo_props?: string | null
  project_ids?: unknown[] | string | null
  start_date?: string | null
  state?: string | null
  fields?: string
  expand?: string
  description_stripped?: string | null
  v1_logo_props?: Record<string, unknown> | string | null
  archived_at?: string | null
  created_by?: string | null
  updated_by?: string | null
}
export interface PlaneCreateInitiativeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Initiatives26c543Schema> }
}

export interface PlaneCreateInitiativeLabelParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  color?: string | null
  description?: string | null
  sort_order?: number | null
  fields?: string
}
export interface PlaneCreateInitiativeLabelResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2InitiativeLabelsc1e575Schema> }
}

export interface PlaneCreateIntakeWorkItemParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  description_html?: string | null
  duplicate_to_id?: string | null
  external_id?: string | null
  external_source?: string | null
  name?: string | null
  priority?: string | null
  snoozed_till?: string | null
  source?: string | null
  source_email?: string | null
  status?: number | null
  fields?: string
  issue?: Record<string, unknown> | string | null
}
export interface PlaneCreateIntakeWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2IntakeWorkItemsd605ceSchema> }
}

export interface PlaneCreateInvitationParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  email: string
  message?: string | null
  role?: string | null
  fields?: string
}
export interface PlaneCreateInvitationResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Invitationsd40deaSchema> }
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
  output: { result: z.output<typeof schemas.planeV2Labels8a1ae6Schema> }
}

export interface PlaneCreateLinkParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  url: string
  metadata?: string | null
  title?: string | null
  fields?: string
  created_by?: string | null
  issue_id?: string | null
}
export interface PlaneCreateLinkResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemLinks329bc3Schema> }
}

export interface PlaneCreateMilestoneParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  title: string
  external_id?: string | null
  external_source?: string | null
  target_date?: string | null
  fields?: string
}
export interface PlaneCreateMilestoneResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Milestones9079dcSchema> }
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
  output: { result: z.output<typeof schemas.planeV2Modules29b3c8Schema> }
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
  output: { result: z.output<typeof schemas.planeV2Projects80208cSchema> }
}

export interface PlaneCreateProjectAutomationParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  scope: string
  description?: string | null
  project_ids?: unknown[] | string | null
  fields?: string
}
export interface PlaneCreateProjectAutomationResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectAutomations88cd0dSchema> }
}

export interface PlaneCreateProjectAutomationEdgeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  automation_id: string
  source_node_id: string
  target_node_id: string
  execution_order?: number | null
  fields?: string
}
export interface PlaneCreateProjectAutomationEdgeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectAutomationsSchema> }
}

export interface PlaneCreateProjectAutomationNodeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  automation_id: string
  handler_name: string
  name: string
  node_type: string
  config?: string | null
  is_enabled?: boolean | null
  fields?: string
}
export interface PlaneCreateProjectAutomationNodeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectAutomationsbfbfc7Schema> }
}

export interface PlaneCreateProjectMappingParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  idp_group_name: string
  role_slug?: string | null
  all_projects?: boolean | null
  project_id?: string | null
  fields?: string
  role?: string | null
  project?: string | null
}
export interface PlaneCreateProjectMappingResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2GroupSync21af09Schema> }
}

export interface PlaneCreateProjectMemberParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  member_id?: string | null
  role?: string | null
  fields?: string
  expand?: string
}
export interface PlaneCreateProjectMemberResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Members0326b2Schema> }
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
  output: { result: z.output<typeof schemas.planeV2ProjectPages0df14eSchema> }
}

export interface PlaneCreateProjectViewParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  access?: string | null
  description?: string | null
  display_filters?: string | null
  display_properties?: string | null
  filters?: string | null
  is_locked?: boolean | null
  logo_props?: string | null
  pql_filters?: string | null
  sort_order?: number | null
  fields?: string
  expand?: string
}
export interface PlaneCreateProjectViewResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectViews116a1aSchema> }
}

export interface PlaneCreateProjectWithTemplateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name?: string | null
  identifier?: string | null
  description?: string | null
  project_lead?: string | null
}
export interface PlaneCreateProjectWithTemplateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeCreateProjectWithTemplateResultbb886aSchema> }
}

export interface PlaneCreateProjectWorkItemTemplateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  template_data: Record<string, unknown> | string
  description_html?: string | null
  is_published?: boolean | null
  short_description?: string | null
  fields?: string
}
export interface PlaneCreateProjectWorkItemTemplateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectWorkItemTemplatesSchema> }
}

export interface PlaneCreatePropertyContextParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  property_id: string
  name?: string | null
  applies_to_all_projects?: boolean | null
  project_ids?: unknown[] | string | null
  applies_to_all_work_item_types?: boolean | null
  issue_type_ids?: unknown[] | string | null
  is_required?: boolean | null
  is_multi?: boolean | null
  default_value?: unknown[] | string | null
  options?: unknown[] | string | null
  settings?: unknown | null
  sort_order?: number | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
}
export interface PlaneCreatePropertyContextResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemPropertyContextsSchema> }
}

export interface PlaneCreatePropertyOptionParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  property_id: string
  name: string
  description?: string | null
  is_default?: boolean | null
  external_id?: string | null
  external_source?: string | null
  is_active?: boolean | null
  parent?: string | null
}
export interface PlaneCreatePropertyOptionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemPropertyOptionsf0877fSchema> }
}

export interface PlaneCreateReleaseParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  description_html?: string | null
  description_json?: string | null
  external_id?: string | null
  external_source?: string | null
  is_latest?: boolean | null
  is_prerelease?: boolean | null
  lead_id?: string | null
  release_date?: string | null
  status?: string | null
  tag_id?: string | null
  target_date?: string | null
  fields?: string
  expand?: string
  v1_description_json?: Record<string, unknown> | string | null
  tag?: string | null
  description?: string | null
  start_date?: string | null
  logo_props?: Record<string, unknown> | string | null
}
export interface PlaneCreateReleaseResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Releases2f1360Schema> }
}

export interface PlaneCreateReleaseCommentParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  release_id: string
  comment_html?: string | null
  is_resolved?: boolean | null
  parent_id?: string | null
  fields?: string
}
export interface PlaneCreateReleaseCommentResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseComments9a1f27Schema> }
}

export interface PlaneCreateReleaseLabelParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  color?: string | null
  sort_order?: number | null
  fields?: string
  v1_sort_order?: number | null
  project?: string | null
}
export interface PlaneCreateReleaseLabelResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseLabels0df496Schema> }
}

export interface PlaneCreateReleaseLinkParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  release_id: string
  title: string
  url: string
  metadata?: string | null
  fields?: string
  v1_metadata?: Record<string, unknown> | string | null
}
export interface PlaneCreateReleaseLinkResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseLinks259dd6Schema> }
}

export interface PlaneCreateReleaseTagParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  version: string
  commit_hash?: string | null
  description?: string | null
  git_tag?: string | null
  fields?: string
  project?: string | null
  name?: string | null
  color?: string | null
}
export interface PlaneCreateReleaseTagResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseTagsb985e4Schema> }
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
  output: { result: z.output<typeof schemas.planeV2States28ce24Schema> }
}

export interface PlaneCreateStickyParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  background_color?: string | null
  color?: string | null
  description_html?: string | null
  logo_props?: string | null
  name?: string | null
  sort_order?: number | null
  fields?: string
  deleted_at?: string | null
  description?: Record<string, unknown> | string | null
  description_stripped?: string | null
  v1_logo_props?: Record<string, unknown> | string | null
  created_by?: string | null
  updated_by?: string | null
  description_binary?: string | null
}
export interface PlaneCreateStickyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Stickiesf0ced7Schema> }
}

export interface PlaneCreateTeamspaceParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  description_html?: string | null
  lead_id?: string | null
  logo_props?: string | null
  member_ids?: unknown[] | string | null
  project_ids?: unknown[] | string | null
  fields?: string
  expand?: string
  description_json?: Record<string, unknown> | string | null
  description_stripped?: string | null
  v1_logo_props?: Record<string, unknown> | string | null
}
export interface PlaneCreateTeamspaceResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Teamspaces2e5b2fSchema> }
}

export interface PlaneCreateUserAssetParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  entity_type: string
  name: string
  size: number
  type?: string | null
  fields?: string
}
export interface PlaneCreateUserAssetResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2UserAssets89dd1aSchema> }
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
  output: { result: z.output<typeof schemas.planeV2WebhooksSchema> }
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
}
export interface PlaneCreateWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItems90ffdaSchema> }
}

export interface PlaneCreateWorkItemPageParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  work_item_id: string
  project_id: string
  workspace_slug: string
  page_id: string
}
export interface PlaneCreateWorkItemPageResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.workItemPagecac7c5Schema> }
}

export interface PlaneCreateWorkItemPropertyParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  display_name: string
  property_type: string
  relation_type?: string | null
  description?: string | null
  options?: unknown[] | string | null
  is_multi?: boolean | null
  is_required?: boolean | null
  is_active?: boolean | null
  default_value?: unknown[] | string | null
  settings?: unknown | null
  validation_rules?: unknown | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
}
export interface PlaneCreateWorkItemPropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemPropertiesSchema> }
}

export interface PlaneCreateWorkItemPropertyValuesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  project_id: string
  property_id: string
  workspace_slug: string
  work_item_id: string
  value: Record<string, unknown> | string
  external_id?: string | null
  external_source?: string | null
}
export interface PlaneCreateWorkItemPropertyValuesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.workItemPropertyValueDetailSchema> }
}

export interface PlaneCreateWorkItemRelationParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  work_item_id: string
  project_id: string
  workspace_slug: string
  relation_type: string
  issues: unknown[] | string
}
export interface PlaneCreateWorkItemRelationResponse extends ToolResponse {
  output: {
    results: z.output<typeof schemas.planeCreateWorkItemRelationResultItemItem5c3495Schema>[]
    detail?: string
  }
}

export interface PlaneCreateWorkItemTypeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  description?: string | null
  is_active?: boolean | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  is_epic?: boolean | null
  project_ids?: unknown[] | string | null
  logo_props?: Record<string, unknown> | string | null
  level?: number | null
}
export interface PlaneCreateWorkItemTypeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemTypes056c22Schema> }
}

export interface PlaneCreateWorkflowParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  description?: string | null
  is_active?: boolean | null
  work_item_type_ids?: unknown[] | string | null
  fields?: string
}
export interface PlaneCreateWorkflowResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkflowsSchema> }
}

export interface PlaneCreateWorkflowStateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  workflow_id: string
  allow_issue_creation?: boolean | null
  is_default?: boolean | null
  type?: string | null
  fields?: string
}
export interface PlaneCreateWorkflowStateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkflowStatesSchema> }
}

export interface PlaneCreateWorkflowTransitionParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  workflow_id: string
  member_ids?: unknown[] | string | null
  rejection_state_id?: string | null
  required_approvals?: number | null
  state_id?: string | null
  transition_state_id?: string | null
  fields?: string
}
export interface PlaneCreateWorkflowTransitionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkflowTransitionsSchema> }
}

export interface PlaneCreateWorklogParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  duration?: number | null
  description?: string | null
  fields?: string
  expand?: string
  created_by?: string | null
  updated_by?: string | null
}
export interface PlaneCreateWorklogResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemWorklogsd59c1cSchema> }
}

export interface PlaneCreateWorkspaceAssetParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  size: number
  entity_type?: string | null
  type?: string | null
  fields?: string
  project_id?: string | null
  entity_identifier?: string | null
  external_id?: string | null
  external_source?: string | null
}
export interface PlaneCreateWorkspaceAssetResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAssets33620dSchema> }
}

export interface PlaneCreateWorkspaceAutomationParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  scope: string
  description?: string | null
  project_ids?: unknown[] | string | null
  fields?: string
}
export interface PlaneCreateWorkspaceAutomationResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAutomations86a400Schema> }
}

export interface PlaneCreateWorkspaceAutomationEdgeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  automation_id: string
  source_node_id: string
  target_node_id: string
  execution_order?: number | null
  fields?: string
}
export interface PlaneCreateWorkspaceAutomationEdgeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAutomationsSchema> }
}

export interface PlaneCreateWorkspaceAutomationNodeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  automation_id: string
  handler_name: string
  name: string
  node_type: string
  config?: string | null
  is_enabled?: boolean | null
  fields?: string
}
export interface PlaneCreateWorkspaceAutomationNodeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAutomations96ac73Schema> }
}

export interface PlaneCreateWorkspaceMappingParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  idp_group_name: string
  role_slug?: string | null
  fields?: string
  role?: string | null
}
export interface PlaneCreateWorkspaceMappingResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2GroupSync997fe5Schema> }
}

export interface PlaneCreateWorkspacePageParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
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
export interface PlaneCreateWorkspacePageResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspacePagesd6a399Schema> }
}

export interface PlaneCreateWorkspacePropertyOptionParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  property_id: string
  name: string
  description?: string | null
  is_default?: boolean | null
  external_id?: string | null
  external_source?: string | null
}
export interface PlaneCreateWorkspacePropertyOptionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemPropertyOptionsSchema> }
}

export interface PlaneCreateWorkspaceViewParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  access?: string | null
  description?: string | null
  display_filters?: string | null
  display_properties?: string | null
  filters?: string | null
  is_locked?: boolean | null
  logo_props?: string | null
  pql_filters?: string | null
  sort_order?: number | null
  fields?: string
  expand?: string
}
export interface PlaneCreateWorkspaceViewResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceViews490e6dSchema> }
}

export interface PlaneCreateWorkspaceWorkItemPropertyParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  display_name: string
  property_type: string
  relation_type?: string | null
  description?: string | null
  is_required?: boolean | null
  is_multi?: boolean | null
  is_active?: boolean | null
  default_value?: unknown[] | string | null
  options?: unknown[] | string | null
  settings?: unknown | null
  validation_rules?: unknown | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
}
export interface PlaneCreateWorkspaceWorkItemPropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemPropertiesSchema> }
}

export interface PlaneCreateWorkspaceWorkItemTemplateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  template_data: Record<string, unknown> | string
  description_html?: string | null
  is_published?: boolean | null
  short_description?: string | null
  fields?: string
}
export interface PlaneCreateWorkspaceWorkItemTemplateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemTemplatesSchema> }
}

export interface PlaneCreateWorkspaceWorkItemTypeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  description?: string | null
  is_active?: boolean | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
}
export interface PlaneCreateWorkspaceWorkItemTypeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemTypesSchema> }
}

export interface PlaneDeleteAssetParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteAssetResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteAttachmentParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteAttachmentResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteCollectionParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
  archive_pages?: boolean
}
export interface PlaneDeleteCollectionResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteCommentParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteCommentResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteCustomerParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteCustomerResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteCustomerPropertyParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteCustomerPropertyResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteCustomerRequestParams extends PlaneCredentials {
  workspace_slug: string
  customer_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteCustomerRequestResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteCycleParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteCycleResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteEstimateParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteEstimateResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteEstimatePointParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  estimate_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteEstimatePointResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteInitiativeParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteInitiativeResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteInitiativeLabelParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteInitiativeLabelResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteIntakeWorkItemParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteIntakeWorkItemResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteInvitationParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteInvitationResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteLabelParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteLabelResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteLinkParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteLinkResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteMilestoneParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteMilestoneResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteModuleParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteModuleResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteProjectParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteProjectResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteProjectAutomationParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteProjectAutomationResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteProjectAutomationEdgeParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  automation_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteProjectAutomationEdgeResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteProjectAutomationNodeParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  automation_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteProjectAutomationNodeResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteProjectMappingParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteProjectMappingResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteProjectMemberParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteProjectMemberResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteProjectPageParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteProjectPageResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteProjectViewParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteProjectViewResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteProjectWorkItemTemplateParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteProjectWorkItemTemplateResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeletePropertyContextParams extends PlaneCredentials {
  workspace_slug: string
  property_id: string
  pk: string
  fields?: string
}
export interface PlaneDeletePropertyContextResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeletePropertyOptionParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  property_id: string
  pk: string
}
export interface PlaneDeletePropertyOptionResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteReleaseParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteReleaseResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteReleaseCommentParams extends PlaneCredentials {
  workspace_slug: string
  release_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteReleaseCommentResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteReleaseLabelParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteReleaseLabelResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteReleaseLinkParams extends PlaneCredentials {
  workspace_slug: string
  release_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteReleaseLinkResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteReleaseTagParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteReleaseTagResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteStateParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteStateResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteStickyParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteStickyResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteTeamspaceParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteTeamspaceResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteUserAssetParams extends PlaneCredentials {
  pk: string
  fields?: string
}
export interface PlaneDeleteUserAssetResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWebhookParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWebhookResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkItemParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteWorkItemResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkItemPageParams extends PlaneCredentials {
  work_item_id: string
  page_id: string
  project_id: string
  workspace_slug: string
}
export interface PlaneDeleteWorkItemPageResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkItemPropertyParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkItemPropertyResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkItemPropertyValueParams extends PlaneCredentials {
  project_id: string
  property_id: string
  workspace_slug: string
  work_item_id: string
}
export interface PlaneDeleteWorkItemPropertyValueResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkItemTypeParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkItemTypeResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkflowParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkflowResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkflowStateParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  workflow_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkflowStateResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkflowTransitionParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  workflow_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkflowTransitionResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorklogParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteWorklogResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkspaceAutomationParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkspaceAutomationResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkspaceAutomationEdgeParams extends PlaneCredentials {
  workspace_slug: string
  automation_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkspaceAutomationEdgeResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkspaceAutomationNodeParams extends PlaneCredentials {
  workspace_slug: string
  automation_id: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkspaceAutomationNodeResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkspaceMappingParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkspaceMappingResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkspacePageParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteWorkspacePageResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkspacePageAttachmentParams extends PlaneCredentials {
  workspace_slug: string
  page_id: string
  attachment_id: string
}
export interface PlaneDeleteWorkspacePageAttachmentResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkspacePropertyOptionParams extends PlaneCredentials {
  workspace_slug: string
  property_id: string
  pk: string
}
export interface PlaneDeleteWorkspacePropertyOptionResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkspaceViewParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneDeleteWorkspaceViewResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkspaceWorkItemPropertyParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkspaceWorkItemPropertyResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkspaceWorkItemTemplateParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkspaceWorkItemTemplateResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDeleteWorkspaceWorkItemTypeParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneDeleteWorkspaceWorkItemTypeResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDetachTypePropertyParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  type_id: string
  pk: string
}
export interface PlaneDetachTypePropertyResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDetachWorkspaceTypePropertyParams extends PlaneCredentials {
  workspace_slug: string
  type_id: string
  pk: string
}
export interface PlaneDetachWorkspaceTypePropertyResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneDownloadWorkspacePageAttachmentParams extends PlaneCredentials {
  workspace_slug: string
  page_id: string
  attachment_id: string
}
export interface PlaneDownloadWorkspacePageAttachmentResponse extends ToolResponse {
  output: { file: PlaneDownloadedFile }
}

export interface PlaneEnableWorkItemTypesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  fields?: string
}
export interface PlaneEnableWorkItemTypesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemTypesSchema> }
}

export interface PlaneGetActivityParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  fields?: string
  expand?: string
  cursor?: string
  order_by?: string
  per_page?: number
}
export interface PlaneGetActivityResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemActivities7d9718Schema> }
}

export interface PlaneGetArtifactParams extends PlaneCredentials {
  workspace_slug: string
  artifact_id: string
}
export interface PlaneGetArtifactResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Artifacts646eaeSchema> }
}

export interface PlaneGetAssetParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetAssetResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAssets0c0a0aSchema> }
}

export interface PlaneGetAttachmentParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  fields?: string
}
export interface PlaneGetAttachmentResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemAttachmentsSchema> }
}

export interface PlaneGetAuditLogParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetAuditLogResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2AuditLogsSchema> }
}

export interface PlaneGetCollectionParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetCollectionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Collections2745f2Schema> }
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
  output: { result: z.output<typeof schemas.planeV2WorkItemComments0c5466Schema> }
}

export interface PlaneGetCurrentUserParams extends PlaneCredentials {}
export interface PlaneGetCurrentUserResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2GetCurrentUserresultbff3bfSchema> }
}

export interface PlaneGetCustomerParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetCustomerResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Customers8e07c4Schema> }
}

export interface PlaneGetCustomerPropertyParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetCustomerPropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2CustomerProperties2dc1f6Schema> }
}

export interface PlaneGetCustomerRequestParams extends PlaneCredentials {
  workspace_slug: string
  customer_id: string
  pk: string
  fields?: string
}
export interface PlaneGetCustomerRequestResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2CustomerRequests7999a5Schema> }
}

export interface PlaneGetCycleParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetCycleResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Cycles6d6772Schema> }
}

export interface PlaneGetCycleWorkItemParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  cycle_id: string
  work_item_id: string
  fields?: string
  expand?: string
}
export interface PlaneGetCycleWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.cycleWorkItem639ff1Schema> }
}

export interface PlaneGetEstimateParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetEstimateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Estimatesb76797Schema> }
}

export interface PlaneGetEstimatePointParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  estimate_id: string
  pk: string
  fields?: string
}
export interface PlaneGetEstimatePointResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2EstimatePointsSchema> }
}

export interface PlaneGetGroupSyncConfigParams extends PlaneCredentials {
  workspace_slug: string
}
export interface PlaneGetGroupSyncConfigResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2GroupSync460c90Schema> }
}

export interface PlaneGetInitiativeParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetInitiativeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Initiatives26c543Schema> }
}

export interface PlaneGetInitiativeLabelParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetInitiativeLabelResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2InitiativeLabelsc1e575Schema> }
}

export interface PlaneGetIntakeWorkItemParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
  external_id?: string
  external_source?: string
  order_by?: string
}
export interface PlaneGetIntakeWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2IntakeWorkItemsd605ceSchema> }
}

export interface PlaneGetInvitationParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetInvitationResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Invitationsd40deaSchema> }
}

export interface PlaneGetLabelParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneGetLabelResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Labels8a1ae6Schema> }
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
  output: { result: z.output<typeof schemas.planeV2WorkItemLinks5e13edSchema> }
}

export interface PlaneGetMilestoneParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneGetMilestoneResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Milestones9079dcSchema> }
}

export interface PlaneGetModuleParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetModuleResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Modules29b3c8Schema> }
}

export interface PlaneGetPermissionSchemeParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetPermissionSchemeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2PermissionSchemesSchema> }
}

export interface PlaneGetProjectParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetProjectResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Projects80208cSchema> }
}

export interface PlaneGetProjectAutomationParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneGetProjectAutomationResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectAutomations88cd0dSchema> }
}

export interface PlaneGetProjectAutomationActivityParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  automation_id: string
  pk: string
  fields?: string
}
export interface PlaneGetProjectAutomationActivityResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectAutomations5b2254Schema> }
}

export interface PlaneGetProjectAutomationEdgeParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  automation_id: string
  pk: string
  fields?: string
}
export interface PlaneGetProjectAutomationEdgeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectAutomationsSchema> }
}

export interface PlaneGetProjectAutomationNodeParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  automation_id: string
  pk: string
  fields?: string
}
export interface PlaneGetProjectAutomationNodeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectAutomationsbfbfc7Schema> }
}

export interface PlaneGetProjectFeaturesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
}
export interface PlaneGetProjectFeaturesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2GetProjectFeaturesresult73a0efSchema> }
}

export interface PlaneGetProjectMappingParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetProjectMappingResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2GroupSync21af09Schema> }
}

export interface PlaneGetProjectMemberParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetProjectMemberResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Members0326b2Schema> }
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
  output: { result: z.output<typeof schemas.planeV2ProjectPages6b917aSchema> }
}

export interface PlaneGetProjectPermissionsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
}
export interface PlaneGetProjectPermissionsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2GetProjectPermissionsresultSchema> }
}

export interface PlaneGetProjectRoleDistributionParams extends PlaneCredentials {
  workspace_slug: string
}
export interface PlaneGetProjectRoleDistributionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2GetProjectRoleDistributionresultSchema> }
}

export interface PlaneGetProjectSummaryParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  counts?: string
  fields?: string
}
export interface PlaneGetProjectSummaryResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2GetProjectSummaryresult4f96bdSchema> }
}

export interface PlaneGetProjectViewParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetProjectViewResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectViews116a1aSchema> }
}

export interface PlaneGetProjectWorkItemTemplateParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneGetProjectWorkItemTemplateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectWorkItemTemplatesSchema> }
}

export interface PlaneGetProjectWorklogSummaryParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
}
export interface PlaneGetProjectWorklogSummaryResponse extends ToolResponse {
  output: {
    results: z.output<typeof schemas.planeV2V2GetProjectWorklogSummaryresultitem9fe59dSchema>[]
    detail?: string
  }
}

export interface PlaneGetPropertyContextParams extends PlaneCredentials {
  workspace_slug: string
  property_id: string
  pk: string
  fields?: string
}
export interface PlaneGetPropertyContextResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemPropertyContextsSchema> }
}

export interface PlaneGetPropertyOptionParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  property_id: string
  pk: string
}
export interface PlaneGetPropertyOptionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemPropertyOptionsf0877fSchema> }
}

export interface PlaneGetReleaseParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetReleaseResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Releases2f1360Schema> }
}

export interface PlaneGetReleaseChangelogParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
}
export interface PlaneGetReleaseChangelogResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Releases6e73e7Schema> }
}

export interface PlaneGetReleaseCommentParams extends PlaneCredentials {
  workspace_slug: string
  release_id: string
  pk: string
  fields?: string
}
export interface PlaneGetReleaseCommentResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseComments9a1f27Schema> }
}

export interface PlaneGetReleaseLabelParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetReleaseLabelResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseLabels0df496Schema> }
}

export interface PlaneGetReleaseLinkParams extends PlaneCredentials {
  workspace_slug: string
  release_id: string
  pk: string
  fields?: string
}
export interface PlaneGetReleaseLinkResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseLinks259dd6Schema> }
}

export interface PlaneGetReleaseTagParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetReleaseTagResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseTagsb985e4Schema> }
}

export interface PlaneGetRoleParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetRoleResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2RolesSchema> }
}

export interface PlaneGetStateParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneGetStateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2States28ce24Schema> }
}

export interface PlaneGetStickyParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetStickyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Stickiesf0ced7Schema> }
}

export interface PlaneGetTeamspaceParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetTeamspaceResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Teamspaces2e5b2fSchema> }
}

export interface PlaneGetTypePropertyParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  type_id: string
  pk: string
  fields?: string
}
export interface PlaneGetTypePropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemTypePropertiesSchema> }
}

export interface PlaneGetUserAssetParams extends PlaneCredentials {
  pk: string
  fields?: string
}
export interface PlaneGetUserAssetResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2UserAssetsSchema> }
}

export interface PlaneGetWebhookParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetWebhookResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WebhooksSchema> }
}

export interface PlaneGetWebhookLogParams extends PlaneCredentials {
  workspace_slug: string
  webhook_id: string
  pk: string
  fields?: string
}
export interface PlaneGetWebhookLogResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WebhookLogsSchema> }
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
  output: { result: z.output<typeof schemas.planeV2WorkItems3d744cSchema> }
}

export interface PlaneGetWorkItemByIdentifierParams extends PlaneCredentials {
  workspace_slug: string
  identifier: string
  expand?: string
  fields?: string
}
export interface PlaneGetWorkItemByIdentifierResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItems49553eSchema> }
}

export interface PlaneGetWorkItemPageParams extends PlaneCredentials {
  work_item_id: string
  page_id: string
  project_id: string
  workspace_slug: string
}
export interface PlaneGetWorkItemPageResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.workItemPagecac7c5Schema> }
}

export interface PlaneGetWorkItemPropertyParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkItemPropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemPropertiesSchema> }
}

export interface PlaneGetWorkItemPropertyValueParams extends PlaneCredentials {
  project_id: string
  property_id: string
  workspace_slug: string
  work_item_id: string
}
export interface PlaneGetWorkItemPropertyValueResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.workItemPropertyValueDetailSchema> }
}

export interface PlaneGetWorkItemSequenceIdParams extends PlaneCredentials {
  issue_identifier: number
  project_identifier: string
  workspace_slug: string
  expand?: string
  fields?: string
  external_id?: string
  external_source?: string
  order_by?: string
}
export interface PlaneGetWorkItemSequenceIdResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeWorkItemContentSchema> }
}

export interface PlaneGetWorkItemTypeParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkItemTypeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemTypes056c22Schema> }
}

export interface PlaneGetWorkItemTypeSchemaParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  include?: string
  fields?: string
}
export interface PlaneGetWorkItemTypeSchemaResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2GetWorkItemTypeSchemaresultSchema> }
}

export interface PlaneGetWorkflowParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkflowResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkflowsSchema> }
}

export interface PlaneGetWorkflowStateParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  workflow_id: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkflowStateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkflowStatesSchema> }
}

export interface PlaneGetWorkflowTransitionParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  workflow_id: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkflowTransitionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkflowTransitionsSchema> }
}

export interface PlaneGetWorklogParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetWorklogResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemWorklogs111186Schema> }
}

export interface PlaneGetWorkspaceAutomationParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkspaceAutomationResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAutomations86a400Schema> }
}

export interface PlaneGetWorkspaceAutomationActivityParams extends PlaneCredentials {
  workspace_slug: string
  automation_id: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkspaceAutomationActivityResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAutomationsa3e54dSchema> }
}

export interface PlaneGetWorkspaceAutomationEdgeParams extends PlaneCredentials {
  workspace_slug: string
  automation_id: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkspaceAutomationEdgeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAutomationsSchema> }
}

export interface PlaneGetWorkspaceAutomationNodeParams extends PlaneCredentials {
  workspace_slug: string
  automation_id: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkspaceAutomationNodeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAutomations96ac73Schema> }
}

export interface PlaneGetWorkspaceFeaturesParams extends PlaneCredentials {
  workspace_slug: string
}
export interface PlaneGetWorkspaceFeaturesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceFeatures56caddSchema> }
}

export interface PlaneGetWorkspaceMappingParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkspaceMappingResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2GroupSync997fe5Schema> }
}

export interface PlaneGetWorkspacePageParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
  external_id?: string
  external_source?: string
  order_by?: string
}
export interface PlaneGetWorkspacePageResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspacePagesc8362fSchema> }
}

export interface PlaneGetWorkspacePageAttachmentParams extends PlaneCredentials {
  workspace_slug: string
  page_id: string
  attachment_id: string
}
export interface PlaneGetWorkspacePageAttachmentResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeGetWorkspacePageAttachmentResultSchema> }
}

export interface PlaneGetWorkspacePermissionsParams extends PlaneCredentials {
  workspace_slug: string
}
export interface PlaneGetWorkspacePermissionsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2GetWorkspacePermissionsresultSchema> }
}

export interface PlaneGetWorkspacePropertyOptionParams extends PlaneCredentials {
  workspace_slug: string
  property_id: string
  pk: string
}
export interface PlaneGetWorkspacePropertyOptionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemPropertyOptionsSchema> }
}

export interface PlaneGetWorkspaceTypePropertyParams extends PlaneCredentials {
  workspace_slug: string
  type_id: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkspaceTypePropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemTypePropertiesSchema> }
}

export interface PlaneGetWorkspaceViewParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneGetWorkspaceViewResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceViews490e6dSchema> }
}

export interface PlaneGetWorkspaceWorkItemPropertyParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkspaceWorkItemPropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemPropertiesSchema> }
}

export interface PlaneGetWorkspaceWorkItemTemplateParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkspaceWorkItemTemplateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemTemplatesSchema> }
}

export interface PlaneGetWorkspaceWorkItemTypeParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneGetWorkspaceWorkItemTypeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemTypesSchema> }
}

export interface PlaneImportWorkItemTypesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_types: unknown[] | string
}
export interface PlaneImportWorkItemTypesResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneListActivitiesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  actor_id?: string
  count?: boolean
  created_at__gte?: string
  created_at__lte?: string
  field?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  verb?: string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListActivitiesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListActivitiesresultSchema> }
    | {
        results: z.output<typeof schemas.workItemActivity7fff5bSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListArchivedCyclesParams extends PlaneCredentials {
  project_id: string
  workspace_slug: string
  cursor?: string
  per_page?: number
}
export interface PlaneListArchivedCyclesResponse extends ToolResponse {
  output: {
    results: z.output<typeof schemas.cycle8c1c16Schema>[]
    detail?: string
    pagination: PlanePagination
  }
}

export interface PlaneListArchivedModulesParams extends PlaneCredentials {
  project_id: string
  workspace_slug: string
  cursor?: string
  expand?: string
  fields?: string
  order_by?: string
  per_page?: number
}
export interface PlaneListArchivedModulesResponse extends ToolResponse {
  output: {
    results: z.output<typeof schemas.modulee68880Schema>[]
    detail?: string
    pagination: PlanePagination
  }
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
    | { results: z.output<typeof schemas.workItemAttachmentc365e0Schema>[]; detail?: string }
}

export interface PlaneListAuditLogsParams extends PlaneCredentials {
  workspace_slug: string
  created_after?: string
  created_before?: string
  fields?: string
  actor_id?: string
  event_name?: string
  category?: string
  outcome?: string
  target_type?: string
  target_id?: string
  ip_address?: string
  search?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
}
export interface PlaneListAuditLogsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListAuditLogsresultSchema> }
}

export interface PlaneListCollectionMembersParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  expand?: string
}
export interface PlaneListCollectionMembersResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2Collections02f138Schema> }
    | { results: z.output<typeof schemas.collectionMembera1654fSchema>[]; detail?: string }
}

export interface PlaneListCollectionPagesParams extends PlaneCredentials {
  workspace_slug: string
  collection_id: string
  parent_id?: string
  search?: string
  created_by?: string
  favorites?: boolean
  labels?: string
  created_at__gte?: string
  created_at__lte?: string
  owned_by_id?: string
  owned_by_id__in?: string
  parent_id__in?: string
  per_page?: number
  cursor?: string
  expand?: string
  fields?: string
  external_id?: string
  external_source?: string
  order_by?: string
}
export interface PlaneListCollectionPagesResponse extends ToolResponse {
  output: {
    results: z.output<typeof schemas.collectionBranchPageeda77cSchema>[]
    detail?: string
    pagination: PlanePagination
  }
}

export interface PlaneListCollectionsParams extends PlaneCredentials {
  workspace_slug: string
  access?: number
  count?: boolean
  is_default?: boolean
  is_global?: boolean
  offset?: number
  order_by?: string
  owned_by_id?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListCollectionsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListCollectionsresultSchema> }
    | { results: z.output<typeof schemas.collectionaec678Schema>[]; detail?: string }
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
        results: z.output<typeof schemas.workItemCommentd35106Schema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListCustomerPropertiesParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  is_active?: boolean
  is_required?: boolean
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  property_type?: string
  search?: string
  fields?: string
  cursor?: string
}
export interface PlaneListCustomerPropertiesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListCustomerPropertiesresultSchema> }
    | {
        results: z.output<typeof schemas.customerProperty195984Schema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListCustomerPropertyValuesParams extends PlaneCredentials {
  workspace_slug: string
  customer_id: string
}
export interface PlaneListCustomerPropertyValuesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.listCustomerPropertyValuesResultSchema> }
}

export interface PlaneListCustomerRequestsParams extends PlaneCredentials {
  workspace_slug: string
  customer_id: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
}
export interface PlaneListCustomerRequestsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListCustomerRequestsresultSchema> }
    | {
        results: z.output<typeof schemas.customerRequestbeca62Schema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListCustomersParams extends PlaneCredentials {
  workspace_slug: string
  contract_status?: string
  count?: boolean
  domain?: string
  external_id?: string
  external_source?: string
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  stage?: string
  fields?: string
  cursor?: string
}
export interface PlaneListCustomersResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListCustomersresultSchema> }
    | {
        results: z.output<typeof schemas.customere0e1edSchema>[]
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

export interface PlaneListEstimatePointsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  estimate_id: string
  count?: boolean
  external_id?: string
  external_source?: string
  key?: number
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  value?: string
  fields?: string
  cursor?: string
}
export interface PlaneListEstimatePointsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListEstimatePointsresultSchema> }
    | { results: z.output<typeof schemas.estimatePointbb0ee0Schema>[]; detail?: string }
}

export interface PlaneListEstimatesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  count?: boolean
  external_id?: string
  external_source?: string
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  type?: string
  type__in?: unknown[] | string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListEstimatesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListEstimatesresultfda80bSchema> }
}

export interface PlaneListInitiativeLabelsParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
}
export interface PlaneListInitiativeLabelsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListInitiativeLabelsresultSchema> }
    | {
        results: z.output<typeof schemas.initiativeLabelf98cdbSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListInitiativesParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  lead_id?: string
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  state?: string
  state__in?: unknown[] | string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListInitiativesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListInitiativesresultSchema> }
    | {
        results: z.output<typeof schemas.initiativef4aa07Schema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListIntakeWorkItemsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  count?: boolean
  external_id?: string
  external_source?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  source?: string
  status?: number
  status__in?: unknown[] | string
  work_item_id?: string
  fields?: string
  cursor?: string
  expand?: string
}
export interface PlaneListIntakeWorkItemsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListIntakeWorkItemsresultSchema> }
    | {
        results: z.output<typeof schemas.intakeWorkItem108b7fSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListInvitationsParams extends PlaneCredentials {
  workspace_slug: string
  accepted?: boolean
  count?: boolean
  email?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
}
export interface PlaneListInvitationsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListInvitationsresultSchema> }
    | {
        results: z.output<typeof schemas.planeListWorkspaceInvitationsResultItemSchema>[]
        detail?: string
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
        results: z.output<typeof schemas.workItemLinkbd3aa8Schema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListMilestoneWorkItemsParams extends PlaneCredentials {
  milestone_id: string
  project_id: string
  workspace_slug: string
  cursor?: string
  per_page?: number
}
export interface PlaneListMilestoneWorkItemsResponse extends ToolResponse {
  output: {
    results: z.output<typeof schemas.milestoneWorkItemSchema>[]
    detail?: string
    pagination: PlanePagination
  }
}

export interface PlaneListMilestonesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  count?: boolean
  external_id?: string
  external_source?: string
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  target_date?: string
  target_date__gte?: string
  target_date__lte?: string
  fields?: string
  cursor?: string
}
export interface PlaneListMilestonesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListMilestonesresultSchema> }
    | {
        results: z.output<typeof schemas.milestoneSchema>[]
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

export interface PlaneListPermissionSchemesParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
}
export interface PlaneListPermissionSchemesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListPermissionSchemesresultSchema> }
}

export interface PlaneListProjectAutomationActivitiesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  automation_id: string
  count?: boolean
  created_at__gt?: string
  field?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  verb?: string
  fields?: string
  cursor?: string
}
export interface PlaneListProjectAutomationActivitiesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListProjectAutomationActivitiesresultSchema> }
}

export interface PlaneListProjectAutomationEdgesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  automation_id: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  source_node_id?: string
  target_node_id?: string
  fields?: string
  cursor?: string
}
export interface PlaneListProjectAutomationEdgesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListProjectAutomationEdgesresultSchema> }
}

export interface PlaneListProjectAutomationNodesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  automation_id: string
  count?: boolean
  handler_name?: string
  is_enabled?: boolean
  name?: string
  node_type?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
}
export interface PlaneListProjectAutomationNodesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListProjectAutomationNodesresultSchema> }
}

export interface PlaneListProjectAutomationsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  count?: boolean
  is_enabled?: boolean
  is_global?: boolean
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  scope?: string
  search?: string
  status?: string
  fields?: string
  cursor?: string
}
export interface PlaneListProjectAutomationsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListProjectAutomationsresultSchema> }
}

export interface PlaneListProjectMappingsParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
  project_identifier?: string
}
export interface PlaneListProjectMappingsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListProjectMappingsresultSchema> }
    | {
        results: z.output<typeof schemas.planeListProjectMappingsResultItem51e494Schema>[]
        detail?: string
      }
}

export interface PlaneListProjectMembersParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  member_id?: string
  role?: string
  search?: string
  fields?: string
  member_id__in?: string
  role__in?: string
  expand?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
}
export interface PlaneListProjectMembersResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListProjectMembersresultSchema> }
    | { results: z.output<typeof schemas.projectMemberSchema>[]; detail?: string }
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

export interface PlaneListProjectViewsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  access?: number
  count?: boolean
  is_locked?: boolean
  name?: string
  offset?: number
  order_by?: string
  owned_by_id?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListProjectViewsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListProjectViewsresultSchema> }
}

export interface PlaneListProjectWorkItemTemplatesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  count?: boolean
  is_published?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  short_id?: string
  fields?: string
  cursor?: string
}
export interface PlaneListProjectWorkItemTemplatesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListProjectWorkItemTemplatesresultSchema> }
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

export interface PlaneListPropertyContextsParams extends PlaneCredentials {
  workspace_slug: string
  property_id: string
  fields?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
}
export interface PlaneListPropertyContextsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListPropertyContextsresultSchema> }
}

export interface PlaneListPropertyOptionsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  property_id: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
}
export interface PlaneListPropertyOptionsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListPropertyOptionsresultSchema> }
    | { results: z.output<typeof schemas.workItemPropertyOption62bf89Schema>[]; detail?: string }
}

export interface PlaneListReleaseCommentsParams extends PlaneCredentials {
  workspace_slug: string
  release_id: string
  count?: boolean
  is_resolved?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  parent_id?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
}
export interface PlaneListReleaseCommentsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListReleaseCommentsresultSchema> }
    | {
        results: z.output<typeof schemas.releaseComment65d33fSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListReleaseLabelsParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
  project_id?: string
}
export interface PlaneListReleaseLabelsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListReleaseLabelsresultSchema> }
    | {
        results: z.output<typeof schemas.releaseLabel1b6179Schema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListReleaseLinksParams extends PlaneCredentials {
  workspace_slug: string
  release_id: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
}
export interface PlaneListReleaseLinksResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListReleaseLinksresultSchema> }
    | {
        results: z.output<typeof schemas.releaseLink8c1f1bSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListReleaseTagsParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  version?: string
  fields?: string
  cursor?: string
  project_id?: string
}
export interface PlaneListReleaseTagsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListReleaseTagsresultSchema> }
    | {
        results: z.output<typeof schemas.releaseTag5b2b5eSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListReleasesParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  is_latest?: boolean
  is_prerelease?: boolean
  lead_id?: string
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  release_date?: string
  search?: string
  status?: string
  status__in?: unknown[] | string
  tag_id?: string
  target_date?: string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListReleasesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListReleasesresultSchema> }
    | {
        results: z.output<typeof schemas.release55ee53Schema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListRolesParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  is_system?: boolean
  namespace?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  new_slug?: string
  fields?: string
  cursor?: string
}
export interface PlaneListRolesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListRolesresultSchema> }
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

export interface PlaneListStickiesParams extends PlaneCredentials {
  workspace_slug: string
  color?: string
  count?: boolean
  offset?: number
  order_by?: string
  owner_id?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
  query?: string
}
export interface PlaneListStickiesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListStickiesresultSchema> }
    | {
        results: z.output<typeof schemas.sticky12cfaeSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListTeamspacesParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  lead_id?: string
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListTeamspacesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListTeamspacesresultSchema> }
    | {
        results: z.output<typeof schemas.teamspaced3d01eSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListTypePropertiesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  type_id: string
  fields?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
}
export interface PlaneListTypePropertiesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListTypePropertiesresultSchema> }
}

export interface PlaneListUserAssetsParams extends PlaneCredentials {
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  fields?: string
  cursor?: string
}
export interface PlaneListUserAssetsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListUserAssetsresultSchema> }
}

export interface PlaneListWebhookLogsParams extends PlaneCredentials {
  workspace_slug: string
  webhook_id: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  fields?: string
  cursor?: string
}
export interface PlaneListWebhookLogsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWebhookLogsresultSchema> }
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

export interface PlaneListWorkItemPagesParams extends PlaneCredentials {
  work_item_id: string
  project_id: string
  workspace_slug: string
  cursor?: string
  order_by?: string
  per_page?: number
}
export interface PlaneListWorkItemPagesResponse extends ToolResponse {
  output: {
    results: z.output<typeof schemas.workItemPage3d85b8Schema>[]
    detail?: string
    pagination: PlanePagination
  }
}

export interface PlaneListWorkItemPropertiesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  fields?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
}
export interface PlaneListWorkItemPropertiesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkItemPropertiesresultSchema> }
}

export interface PlaneListWorkItemRelationsParams extends PlaneCredentials {
  work_item_id: string
  project_id: string
  workspace_slug: string
  cursor?: string
  expand?: string
  fields?: string
  order_by?: string
  per_page?: number
}
export interface PlaneListWorkItemRelationsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.workItemRelationsSchema> }
}

export interface PlaneListWorkItemTypesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  fields?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
}
export interface PlaneListWorkItemTypesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListWorkItemTypesresultSchema> }
    | { results: z.output<typeof schemas.workItemTypea15c03Schema>[]; detail?: string }
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

export interface PlaneListWorkflowStatesParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  workflow_id: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  fields?: string
  cursor?: string
}
export interface PlaneListWorkflowStatesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkflowStatesresultSchema> }
}

export interface PlaneListWorkflowTransitionsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  workflow_id: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  fields?: string
  cursor?: string
}
export interface PlaneListWorkflowTransitionsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkflowTransitionsresultSchema> }
}

export interface PlaneListWorkflowsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
}
export interface PlaneListWorkflowsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkflowsresultSchema> }
}

export interface PlaneListWorklogsParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  work_item_id: string
  count?: boolean
  duration__gte?: number
  duration__lte?: number
  logged_by_id?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListWorklogsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListWorklogsresultSchema> }
    | { results: z.output<typeof schemas.workItemWorkLog7cf3b8Schema>[]; detail?: string }
}

export interface PlaneListWorkspaceAssetsParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  fields?: string
  cursor?: string
}
export interface PlaneListWorkspaceAssetsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkspaceAssetsresultSchema> }
}

export interface PlaneListWorkspaceAutomationActivitiesParams extends PlaneCredentials {
  workspace_slug: string
  automation_id: string
  count?: boolean
  created_at__gt?: string
  field?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  verb?: string
  fields?: string
  cursor?: string
}
export interface PlaneListWorkspaceAutomationActivitiesResponse extends ToolResponse {
  output: {
    result: z.output<typeof schemas.planeV2V2ListWorkspaceAutomationActivitiesresultSchema>
  }
}

export interface PlaneListWorkspaceAutomationEdgesParams extends PlaneCredentials {
  workspace_slug: string
  automation_id: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  source_node_id?: string
  target_node_id?: string
  fields?: string
  cursor?: string
}
export interface PlaneListWorkspaceAutomationEdgesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkspaceAutomationEdgesresultSchema> }
}

export interface PlaneListWorkspaceAutomationNodesParams extends PlaneCredentials {
  workspace_slug: string
  automation_id: string
  count?: boolean
  handler_name?: string
  is_enabled?: boolean
  name?: string
  node_type?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
}
export interface PlaneListWorkspaceAutomationNodesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkspaceAutomationNodesresultSchema> }
}

export interface PlaneListWorkspaceAutomationsParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  is_enabled?: boolean
  is_global?: boolean
  name?: string
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  scope?: string
  search?: string
  status?: string
  fields?: string
  cursor?: string
}
export interface PlaneListWorkspaceAutomationsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkspaceAutomationsresultSchema> }
}

export interface PlaneListWorkspaceMappingsParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  cursor?: string
}
export interface PlaneListWorkspaceMappingsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListWorkspaceMappingsresultSchema> }
    | {
        results: z.output<typeof schemas.planeListWorkspaceMappingsResultItemSchema>[]
        detail?: string
      }
}

export interface PlaneListWorkspaceMembersParams extends PlaneCredentials {
  workspace_slug: string
  member_id?: string
  role?: string
  search?: string
  fields?: string
  member_id__in?: string
  role__in?: string
  expand?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
  external_id?: string
  external_source?: string
  first_name?: string
  last_name?: string
  email?: string
  display_name?: string
  role_slug?: string
  is_active?: boolean
  is_bot?: boolean
}
export interface PlaneListWorkspaceMembersResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListWorkspaceMembersresultSchema> }
    | { results: z.output<typeof schemas.workspaceMemberSchema>[]; detail?: string }
}

export interface PlaneListWorkspacePagesParams extends PlaneCredentials {
  workspace_slug: string
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
export interface PlaneListWorkspacePagesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ListWorkspacePagesresultSchema> }
    | {
        results: z.output<typeof schemas.planePageContentSchema>[]
        detail?: string
        pagination: PlanePagination
      }
}

export interface PlaneListWorkspacePropertyOptionsParams extends PlaneCredentials {
  workspace_slug: string
  property_id: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
}
export interface PlaneListWorkspacePropertyOptionsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkspacePropertyOptionsresultSchema> }
}

export interface PlaneListWorkspaceTypePropertiesParams extends PlaneCredentials {
  workspace_slug: string
  type_id: string
  fields?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
}
export interface PlaneListWorkspaceTypePropertiesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkspaceTypePropertiesresultSchema> }
}

export interface PlaneListWorkspaceViewsParams extends PlaneCredentials {
  workspace_slug: string
  access?: number
  count?: boolean
  is_locked?: boolean
  name?: string
  offset?: number
  order_by?: string
  owned_by_id?: string
  paginate?: string
  per_page?: number
  search?: string
  fields?: string
  expand?: string
  cursor?: string
}
export interface PlaneListWorkspaceViewsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkspaceViewsresultSchema> }
}

export interface PlaneListWorkspaceWorkItemPropertiesParams extends PlaneCredentials {
  workspace_slug: string
  fields?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
}
export interface PlaneListWorkspaceWorkItemPropertiesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkspaceWorkItemPropertiesresultSchema> }
}

export interface PlaneListWorkspaceWorkItemTemplatesParams extends PlaneCredentials {
  workspace_slug: string
  count?: boolean
  is_published?: boolean
  offset?: number
  order_by?: string
  paginate?: string
  per_page?: number
  search?: string
  short_id?: string
  fields?: string
  cursor?: string
}
export interface PlaneListWorkspaceWorkItemTemplatesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkspaceWorkItemTemplatesresultSchema> }
}

export interface PlaneListWorkspaceWorkItemTypesParams extends PlaneCredentials {
  workspace_slug: string
  fields?: string
  order_by?: string
  per_page?: number
  offset?: number
  paginate?: string
  count?: boolean
  cursor?: string
}
export interface PlaneListWorkspaceWorkItemTypesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ListWorkspaceWorkItemTypesresultSchema> }
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

export interface PlaneManageCollectionMembersParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  add?: unknown[] | string | null
  remove?: unknown[] | string | null
  member?: string | null
  access?: number | null
}
export interface PlaneManageCollectionMembersResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ManageCollectionMembersresult8b24a1Schema> }
}

export interface PlaneManageCollectionPagesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  add?: unknown[] | string | null
  remove?: unknown[] | string | null
  page_ids?: unknown[] | string | null
  sort_orders?: Record<string, unknown> | string | null
  placement?: Record<string, unknown> | string | null
}
export interface PlaneManageCollectionPagesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ManageCollectionPagesresultSchema> }
    | { results: z.output<typeof schemas.collectionPaged68582Schema>[]; detail?: string }
}

export interface PlaneManageCustomerWorkItemsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  add?: unknown[] | string | null
  remove?: unknown[] | string | null
}
export interface PlaneManageCustomerWorkItemsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ManageCustomerWorkItemsresultSchema> }
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

export interface PlaneManageInitiativeLabelsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  add?: unknown[] | string | null
  remove?: unknown[] | string | null
  label_ids?: unknown[] | string | null
}
export interface PlaneManageInitiativeLabelsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ManageInitiativeLabelsresultSchema> }
    | { results: z.output<typeof schemas.initiativeLabel4c6facSchema>[]; detail?: string }
}

export interface PlaneManageInitiativeProjectsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  add?: unknown[] | string | null
  remove?: unknown[] | string | null
  project_ids?: unknown[] | string | null
}
export interface PlaneManageInitiativeProjectsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ManageInitiativeProjectsresultSchema> }
    | { results: z.output<typeof schemas.project51fea9Schema>[]; detail?: string }
}

export interface PlaneManageInitiativeWorkItemsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  add?: unknown[] | string | null
  remove?: unknown[] | string | null
}
export interface PlaneManageInitiativeWorkItemsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ManageInitiativeWorkItemsresultSchema> }
}

export interface PlaneManageMilestoneWorkItemsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  add?: unknown[] | string | null
  remove?: unknown[] | string | null
}
export interface PlaneManageMilestoneWorkItemsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ManageMilestoneWorkItemsresultSchema> }
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

export interface PlaneManageReleaseLabelsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  add?: unknown[] | string | null
  remove?: unknown[] | string | null
  label_ids?: unknown[] | string | null
}
export interface PlaneManageReleaseLabelsResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2V2ManageReleaseLabelsresultSchema> }
    | { results: z.output<typeof schemas.releaseLabel1b6179Schema>[]; detail?: string }
}

export interface PlaneManageReleaseWorkItemsParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  add?: unknown[] | string | null
  remove?: unknown[] | string | null
  work_item_ids?: unknown[] | string | null
}
export interface PlaneManageReleaseWorkItemsResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2ManageReleaseWorkItemsresult0e13c5Schema> }
}

export interface PlaneMarkDefaultWorkItemTypeParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  pk: string
  fields?: string
}
export interface PlaneMarkDefaultWorkItemTypeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemTypesSchema> }
}

export interface PlaneMarkDefaultWorkspaceWorkItemTypeParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneMarkDefaultWorkspaceWorkItemTypeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemTypesSchema> }
}

export interface PlaneMoveOrReorderCollectionPageParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  collection_id: string
  page_collection_id: string
  collection?: string | null
  sort_order?: number | null
  placement?: Record<string, unknown> | string | null
}
export interface PlaneMoveOrReorderCollectionPageResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.collectionPaged68582Schema> }
}

export interface PlaneProjectRegenerateNodeWebhookSecretParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  automation_id: string
  pk: string
}
export interface PlaneProjectRegenerateNodeWebhookSecretResponse extends ToolResponse {
  output: {
    result: z.output<typeof schemas.planeV2V2ProjectRegenerateNodeWebhookSecretresultSchema>
  }
}

export interface PlanePublishArtifactParams extends PlaneCredentials {
  workspace_slug: string
  artifact_id: string
}
export interface PlanePublishArtifactResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2PublishArtifactresultSchema> }
}

export interface PlaneRegenerateWebhookSecretParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
}
export interface PlaneRegenerateWebhookSecretResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2RegenerateWebhookSecretresultSchema> }
}

export interface PlaneRemoveWorkItemRelationParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  work_item_id: string
  project_id: string
  workspace_slug: string
  related_issue: string
}
export interface PlaneRemoveWorkItemRelationResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneRemoveWorkspaceMemberParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  email?: string | null
  remove_seat?: boolean | null
}
export interface PlaneRemoveWorkspaceMemberResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneRestoreProjectPageParams extends PlaneCredentials {
  workspace_slug: string
  project_id: string
  page_id: string
}
export interface PlaneRestoreProjectPageResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneRestoreWorkspacePageParams extends PlaneCredentials {
  workspace_slug: string
  page_id: string
}
export interface PlaneRestoreWorkspacePageResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneSearchCollectionPagesParams extends PlaneCredentials {
  workspace_slug: string
  pk: string
  fields?: string
  search?: string
}
export interface PlaneSearchCollectionPagesResponse extends ToolResponse {
  output:
    | { result: z.output<typeof schemas.planeV2Collections992736Schema> }
    | { results: z.output<typeof schemas.collectionPageSearchResultSchema>[]; detail?: string }
}

export interface PlaneSetCustomerPropertyValuesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  customer_id: string
  values: Record<string, unknown> | string
}
export interface PlaneSetCustomerPropertyValuesResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneSetProjectAutomationStatusParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  is_enabled: boolean
}
export interface PlaneSetProjectAutomationStatusResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneSetWorkspaceAutomationStatusParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  is_enabled: boolean
}
export interface PlaneSetWorkspaceAutomationStatusResponse extends ToolResponse {
  output: { success: boolean }
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

export interface PlaneUnarchiveCycleParams extends PlaneCredentials {
  cycle_id: string
  project_id: string
  workspace_slug: string
}
export interface PlaneUnarchiveCycleResponse extends ToolResponse {
  output: { success: boolean }
}

export interface PlaneUnarchiveModuleParams extends PlaneCredentials {
  resource_id: string
  project_id: string
  workspace_slug: string
}
export interface PlaneUnarchiveModuleResponse extends ToolResponse {
  output: { success: boolean }
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
  output: { result: z.output<typeof schemas.planeV2WorkItems029d81Schema> }
}

export interface PlaneUpdateArtifactParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  artifact_id: string
  html: string
  prompt?: string | null
}
export interface PlaneUpdateArtifactResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Artifacts646eaeSchema> }
}

export interface PlaneUpdateCollectionParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  access?: string | null
  is_default?: boolean | null
  is_global?: boolean | null
  logo_props?: string | null
  name?: string | null
  sort_order?: number | null
  fields?: string
  expand?: string
  v1_logo_props?: Record<string, unknown> | string | null
}
export interface PlaneUpdateCollectionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Collections2745f2Schema> }
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
  output: { result: z.output<typeof schemas.planeV2WorkItemComments0c5466Schema> }
}

export interface PlaneUpdateCustomerParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  contract_status?: string | null
  description?: string | null
  description_html?: string | null
  domain?: string | null
  email?: string | null
  employees?: number | null
  external_id?: string | null
  external_source?: string | null
  logo_props?: string | null
  name?: string | null
  revenue?: string | null
  stage?: string | null
  website_url?: string | null
  fields?: string
  v1_description?: Record<string, unknown> | string | null
  description_stripped?: string | null
  v1_logo_props?: Record<string, unknown> | string | null
  archived_at?: string | null
  created_by?: string | null
  updated_by?: string | null
  logo_asset?: string | null
}
export interface PlaneUpdateCustomerResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Customers8e07c4Schema> }
}

export interface PlaneUpdateCustomerPropertyParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  default_value?: unknown[] | string | null
  description?: string | null
  display_name?: string | null
  external_id?: string | null
  external_source?: string | null
  is_active?: boolean | null
  is_multi?: boolean | null
  is_required?: boolean | null
  logo_props?: string | null
  options?: unknown[] | string | null
  property_type?: string | null
  relation_type?: string | null
  settings?: string | null
  validation_rules?: string | null
  fields?: string
  v1_logo_props?: Record<string, unknown> | string | null
  sort_order?: number | null
  v1_settings?: Record<string, unknown> | string | null
  v1_validation_rules?: Record<string, unknown> | string | null
  created_by?: string | null
  updated_by?: string | null
}
export interface PlaneUpdateCustomerPropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2CustomerProperties2dc1f6Schema> }
}

export interface PlaneUpdateCustomerRequestParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  customer_id: string
  pk: string
  description?: string | null
  description_html?: string | null
  link?: string | null
  name?: string | null
  work_item_ids?: unknown[] | string | null
  fields?: string
  v1_description?: Record<string, unknown> | string | null
}
export interface PlaneUpdateCustomerRequestResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2CustomerRequests7999a5Schema> }
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
  output: { result: z.output<typeof schemas.planeV2Cycles6d6772Schema> }
}

export interface PlaneUpdateEstimateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  description?: string | null
  external_id?: string | null
  external_source?: string | null
  name?: string | null
  type?: string | null
  fields?: string
  expand?: string
}
export interface PlaneUpdateEstimateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Estimatesb76797Schema> }
}

export interface PlaneUpdateEstimatePointParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  estimate_id: string
  pk: string
  description?: string | null
  external_id?: string | null
  external_source?: string | null
  key?: number | null
  value?: string | null
  fields?: string
}
export interface PlaneUpdateEstimatePointResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2EstimatePointsb9f075Schema> }
}

export interface PlaneUpdateGroupSyncConfigParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  auto_remove?: boolean | null
  default_workspace_role_slug?: string | null
  group_attribute_key?: string | null
  is_enabled?: boolean | null
  sync_offline?: boolean | null
  sync_on_login?: boolean | null
  default_workspace_role?: string | null
}
export interface PlaneUpdateGroupSyncConfigResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2GroupSync460c90Schema> }
}

export interface PlaneUpdateInitiativeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  description?: string | null
  description_html?: string | null
  end_date?: string | null
  lead_id?: string | null
  logo_props?: string | null
  name?: string | null
  project_ids?: unknown[] | string | null
  start_date?: string | null
  state?: string | null
  fields?: string
  expand?: string
  description_stripped?: string | null
  v1_logo_props?: Record<string, unknown> | string | null
  archived_at?: string | null
  created_by?: string | null
  updated_by?: string | null
}
export interface PlaneUpdateInitiativeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Initiatives26c543Schema> }
}

export interface PlaneUpdateInitiativeLabelParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  color?: string | null
  description?: string | null
  name?: string | null
  sort_order?: number | null
  fields?: string
}
export interface PlaneUpdateInitiativeLabelResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2InitiativeLabelsc1e575Schema> }
}

export interface PlaneUpdateIntakeWorkItemParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  description_html?: string | null
  duplicate_to_id?: string | null
  external_id?: string | null
  external_source?: string | null
  name?: string | null
  priority?: string | null
  snoozed_till?: string | null
  source?: string | null
  source_email?: string | null
  status?: number | null
  fields?: string
  duplicate_to?: string | null
  issue?: Record<string, unknown> | string | null
}
export interface PlaneUpdateIntakeWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2IntakeWorkItemsd605ceSchema> }
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
  output: { result: z.output<typeof schemas.planeV2Labels8a1ae6Schema> }
}

export interface PlaneUpdateLinkParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  metadata?: string | null
  title?: string | null
  url?: string | null
  fields?: string
  issue_id?: string | null
}
export interface PlaneUpdateLinkResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemLinks329bc3Schema> }
}

export interface PlaneUpdateMilestoneParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  external_id?: string | null
  external_source?: string | null
  target_date?: string | null
  title?: string | null
  fields?: string
}
export interface PlaneUpdateMilestoneResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Milestones9079dcSchema> }
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
  output: { result: z.output<typeof schemas.planeV2Modules29b3c8Schema> }
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
  output: { result: z.output<typeof schemas.planeV2Projects80208cSchema> }
}

export interface PlaneUpdateProjectAutomationParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  description?: string | null
  name?: string | null
  project_ids?: unknown[] | string | null
  scope?: string | null
  fields?: string
}
export interface PlaneUpdateProjectAutomationResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectAutomations88cd0dSchema> }
}

export interface PlaneUpdateProjectAutomationEdgeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  automation_id: string
  pk: string
  execution_order?: number | null
  source_node_id?: string | null
  target_node_id?: string | null
  fields?: string
}
export interface PlaneUpdateProjectAutomationEdgeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectAutomationsSchema> }
}

export interface PlaneUpdateProjectAutomationNodeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  automation_id: string
  pk: string
  config?: string | null
  handler_name?: string | null
  is_enabled?: boolean | null
  name?: string | null
  node_type?: string | null
  fields?: string
}
export interface PlaneUpdateProjectAutomationNodeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectAutomationsbfbfc7Schema> }
}

export interface PlaneUpdateProjectFeaturesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  is_automated_cycle_enabled?: boolean | null
  is_epic_enabled?: boolean | null
  is_manually_start_end_cycles_enabled?: boolean | null
  is_milestone_enabled?: boolean | null
  is_parallel_cycles_enabled?: boolean | null
  is_project_updates_enabled?: boolean | null
  is_workflow_enabled?: boolean | null
  epics?: boolean | null
  modules?: boolean | null
  cycles?: boolean | null
  views?: boolean | null
  pages?: boolean | null
  intakes?: boolean | null
  work_item_types?: boolean | null
  workflows?: boolean | null
  parallel_cycles?: boolean | null
  project_updates?: boolean | null
}
export interface PlaneUpdateProjectFeaturesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2V2UpdateProjectFeaturesresult8240b7Schema> }
}

export interface PlaneUpdateProjectMappingParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  all_projects?: boolean | null
  idp_group_name?: string | null
  project_id?: string | null
  role_slug?: string | null
  fields?: string
  role?: string | null
  project?: string | null
}
export interface PlaneUpdateProjectMappingResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2GroupSync21af09Schema> }
}

export interface PlaneUpdateProjectMappingByKeyParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_key: string
  idp_group_name: string
  new_idp_group_name?: string | null
  role?: string | null
  project?: string | null
  all_projects?: boolean | null
}
export interface PlaneUpdateProjectMappingByKeyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeUpdateProjectMappingByKeyResult5729c9Schema> }
}

export interface PlaneUpdateProjectMemberParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  member_id?: string | null
  role?: string | null
  fields?: string
  expand?: string
}
export interface PlaneUpdateProjectMemberResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Members0326b2Schema> }
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
  output: { result: z.output<typeof schemas.planeV2ProjectPages6b917aSchema> }
}

export interface PlaneUpdateProjectViewParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  access?: string | null
  description?: string | null
  display_filters?: string | null
  display_properties?: string | null
  filters?: string | null
  is_locked?: boolean | null
  logo_props?: string | null
  name?: string | null
  pql_filters?: string | null
  sort_order?: number | null
  fields?: string
  expand?: string
}
export interface PlaneUpdateProjectViewResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectViews116a1aSchema> }
}

export interface PlaneUpdateProjectWorkItemTemplateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  description_html?: string | null
  is_published?: boolean | null
  name?: string | null
  short_description?: string | null
  template_data?: Record<string, unknown> | string | null
  fields?: string
}
export interface PlaneUpdateProjectWorkItemTemplateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectWorkItemTemplatesSchema> }
}

export interface PlaneUpdatePropertyContextParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  property_id: string
  pk: string
  name?: string | null
  applies_to_all_projects?: boolean | null
  project_ids?: unknown[] | string | null
  applies_to_all_work_item_types?: boolean | null
  issue_type_ids?: unknown[] | string | null
  is_required?: boolean | null
  is_multi?: boolean | null
  default_value?: unknown[] | string | null
  options?: unknown[] | string | null
  settings?: unknown | null
  sort_order?: number | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
}
export interface PlaneUpdatePropertyContextResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemPropertyContextsSchema> }
}

export interface PlaneUpdatePropertyOptionParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  property_id: string
  pk: string
  name?: string | null
  description?: string | null
  is_default?: boolean | null
  external_id?: string | null
  external_source?: string | null
  is_active?: boolean | null
  parent?: string | null
}
export interface PlaneUpdatePropertyOptionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemPropertyOptionsf0877fSchema> }
}

export interface PlaneUpdateReleaseParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  description_html?: string | null
  description_json?: string | null
  external_id?: string | null
  external_source?: string | null
  is_latest?: boolean | null
  is_prerelease?: boolean | null
  lead_id?: string | null
  name?: string | null
  release_date?: string | null
  status?: string | null
  tag_id?: string | null
  target_date?: string | null
  fields?: string
  expand?: string
  v1_description_json?: Record<string, unknown> | string | null
  tag?: string | null
  description?: string | null
  start_date?: string | null
  logo_props?: Record<string, unknown> | string | null
}
export interface PlaneUpdateReleaseResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Releases2f1360Schema> }
}

export interface PlaneUpdateReleaseChangelogParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  description_html?: string | null
  description_json?: string | null
  v1_description_json?: Record<string, unknown> | string | null
}
export interface PlaneUpdateReleaseChangelogResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Releases6e73e7Schema> }
}

export interface PlaneUpdateReleaseCommentParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  release_id: string
  pk: string
  comment_html?: string | null
  is_resolved?: boolean | null
  parent_id?: string | null
  fields?: string
  edited_at?: string | null
}
export interface PlaneUpdateReleaseCommentResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseComments9a1f27Schema> }
}

export interface PlaneUpdateReleaseLabelParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  color?: string | null
  name?: string | null
  sort_order?: number | null
  fields?: string
  v1_sort_order?: number | null
}
export interface PlaneUpdateReleaseLabelResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseLabels0df496Schema> }
}

export interface PlaneUpdateReleaseLinkParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  release_id: string
  pk: string
  metadata?: string | null
  title?: string | null
  url?: string | null
  fields?: string
  v1_metadata?: Record<string, unknown> | string | null
}
export interface PlaneUpdateReleaseLinkResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseLinks259dd6Schema> }
}

export interface PlaneUpdateReleaseTagParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  commit_hash?: string | null
  description?: string | null
  git_tag?: string | null
  version?: string | null
  fields?: string
}
export interface PlaneUpdateReleaseTagResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ReleaseTagsb985e4Schema> }
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
  output: { result: z.output<typeof schemas.planeV2States28ce24Schema> }
}

export interface PlaneUpdateStickyParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  background_color?: string | null
  color?: string | null
  description_html?: string | null
  logo_props?: string | null
  name?: string | null
  sort_order?: number | null
  fields?: string
  deleted_at?: string | null
  description?: Record<string, unknown> | string | null
  description_stripped?: string | null
  v1_logo_props?: Record<string, unknown> | string | null
  created_by?: string | null
  updated_by?: string | null
  description_binary?: string | null
}
export interface PlaneUpdateStickyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Stickiesf0ced7Schema> }
}

export interface PlaneUpdateTeamspaceParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  description_html?: string | null
  lead_id?: string | null
  logo_props?: string | null
  member_ids?: unknown[] | string | null
  name?: string | null
  project_ids?: unknown[] | string | null
  fields?: string
  expand?: string
  description_json?: Record<string, unknown> | string | null
  description_stripped?: string | null
  v1_logo_props?: Record<string, unknown> | string | null
}
export interface PlaneUpdateTeamspaceResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Teamspaces5a249dSchema> }
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
  output: { result: z.output<typeof schemas.planeV2WebhooksSchema> }
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
}
export interface PlaneUpdateWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItems90ffdaSchema> }
}

export interface PlaneUpdateWorkItemPropertyParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  display_name?: string | null
  description?: string | null
  property_type?: string | null
  relation_type?: string | null
  options?: unknown[] | string | null
  is_multi?: boolean | null
  is_required?: boolean | null
  is_active?: boolean | null
  default_value?: unknown[] | string | null
  settings?: unknown | null
  validation_rules?: unknown | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
}
export interface PlaneUpdateWorkItemPropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemPropertiesa758d8Schema> }
}

export interface PlaneUpdateWorkItemPropertyValueParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  project_id: string
  property_id: string
  workspace_slug: string
  work_item_id: string
  value?: Record<string, unknown> | string | null
  external_id?: string | null
  external_source?: string | null
}
export interface PlaneUpdateWorkItemPropertyValueResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.workItemPropertyValueDetailSchema> }
}

export interface PlaneUpdateWorkItemTypeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  name?: string | null
  description?: string | null
  is_active?: boolean | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  is_epic?: boolean | null
  project_ids?: unknown[] | string | null
  logo_props?: Record<string, unknown> | string | null
  level?: number | null
}
export interface PlaneUpdateWorkItemTypeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemTypes056c22Schema> }
}

export interface PlaneUpdateWorkflowParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  description?: string | null
  is_active?: boolean | null
  name?: string | null
  work_item_type_ids?: unknown[] | string | null
  fields?: string
}
export interface PlaneUpdateWorkflowResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkflowsSchema> }
}

export interface PlaneUpdateWorkflowStateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  workflow_id: string
  pk: string
  allow_issue_creation?: boolean | null
  is_default?: boolean | null
  type?: string | null
  fields?: string
}
export interface PlaneUpdateWorkflowStateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkflowStatesSchema> }
}

export interface PlaneUpdateWorkflowTransitionParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  workflow_id: string
  pk: string
  member_ids?: unknown[] | string | null
  rejection_state_id?: string | null
  required_approvals?: number | null
  state_id?: string | null
  transition_state_id?: string | null
  fields?: string
}
export interface PlaneUpdateWorkflowTransitionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkflowTransitionsSchema> }
}

export interface PlaneUpdateWorklogParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  pk: string
  description?: string | null
  duration?: number | null
  fields?: string
  expand?: string
  created_by?: string | null
  updated_by?: string | null
}
export interface PlaneUpdateWorklogResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemWorklogsd59c1cSchema> }
}

export interface PlaneUpdateWorkspaceAutomationParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  description?: string | null
  name?: string | null
  project_ids?: unknown[] | string | null
  scope?: string | null
  fields?: string
}
export interface PlaneUpdateWorkspaceAutomationResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAutomations86a400Schema> }
}

export interface PlaneUpdateWorkspaceAutomationEdgeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  automation_id: string
  pk: string
  execution_order?: number | null
  source_node_id?: string | null
  target_node_id?: string | null
  fields?: string
}
export interface PlaneUpdateWorkspaceAutomationEdgeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAutomationsSchema> }
}

export interface PlaneUpdateWorkspaceAutomationNodeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  automation_id: string
  pk: string
  config?: string | null
  handler_name?: string | null
  is_enabled?: boolean | null
  name?: string | null
  node_type?: string | null
  fields?: string
}
export interface PlaneUpdateWorkspaceAutomationNodeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceAutomations96ac73Schema> }
}

export interface PlaneUpdateWorkspaceFeaturesParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  is_work_item_types_enabled?: boolean | null
  work_item_type_default_level?: number | null
  is_workitem_hierarchy_enabled?: boolean | null
  is_project_grouping_enabled?: boolean | null
  is_teams_enabled?: boolean | null
  is_wiki_enabled?: boolean | null
  is_initiative_enabled?: boolean | null
  is_customer_enabled?: boolean | null
  is_release_enabled?: boolean | null
  is_state_duration_enabled?: boolean | null
  is_pi_enabled?: boolean | null
  project_grouping?: boolean | null
  initiatives?: boolean | null
  teams?: boolean | null
  customers?: boolean | null
  wiki?: boolean | null
  pi?: boolean | null
  work_item_types?: boolean | null
  releases?: boolean | null
  states_owned_by_workspace?: boolean | null
}
export interface PlaneUpdateWorkspaceFeaturesResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceFeatures56caddSchema> }
}

export interface PlaneUpdateWorkspaceInvitationParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  invitation_id: string
  workspace_slug: string
  role?: number | null
}
export interface PlaneUpdateWorkspaceInvitationResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeUpdateWorkspaceInvitationResultSchema> }
}

export interface PlaneUpdateWorkspaceMappingParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  idp_group_name?: string | null
  role_slug?: string | null
  fields?: string
  role?: string | null
}
export interface PlaneUpdateWorkspaceMappingResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2GroupSync997fe5Schema> }
}

export interface PlaneUpdateWorkspacePageParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
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
export interface PlaneUpdateWorkspacePageResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspacePagesc8362fSchema> }
}

export interface PlaneUpdateWorkspacePropertyOptionParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  property_id: string
  pk: string
  name?: string | null
  description?: string | null
  is_default?: boolean | null
  external_id?: string | null
  external_source?: string | null
}
export interface PlaneUpdateWorkspacePropertyOptionResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemPropertyOptionsSchema> }
}

export interface PlaneUpdateWorkspaceViewParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  access?: string | null
  description?: string | null
  display_filters?: string | null
  display_properties?: string | null
  filters?: string | null
  is_locked?: boolean | null
  logo_props?: string | null
  name?: string | null
  pql_filters?: string | null
  sort_order?: number | null
  fields?: string
  expand?: string
}
export interface PlaneUpdateWorkspaceViewResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceViews490e6dSchema> }
}

export interface PlaneUpdateWorkspaceWorkItemPropertyParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  display_name?: string | null
  property_type?: string | null
  relation_type?: string | null
  description?: string | null
  is_required?: boolean | null
  is_multi?: boolean | null
  is_active?: boolean | null
  default_value?: unknown[] | string | null
  options?: unknown[] | string | null
  settings?: unknown | null
  validation_rules?: unknown | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
}
export interface PlaneUpdateWorkspaceWorkItemPropertyResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemPropertiesSchema> }
}

export interface PlaneUpdateWorkspaceWorkItemTemplateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  description_html?: string | null
  is_published?: boolean | null
  name?: string | null
  short_description?: string | null
  template_data?: Record<string, unknown> | string | null
  fields?: string
}
export interface PlaneUpdateWorkspaceWorkItemTemplateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemTemplatesSchema> }
}

export interface PlaneUpdateWorkspaceWorkItemTypeParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  pk: string
  name?: string | null
  description?: string | null
  is_active?: boolean | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
}
export interface PlaneUpdateWorkspaceWorkItemTypeResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkspaceWorkItemTypesSchema> }
}

export interface PlaneUpsertCommentParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  work_item_id: string
  comment_html: string
  access?: string | null
  external_id?: string | null
  external_source?: string | null
  fields?: string
  expand?: string
}
export interface PlaneUpsertCommentResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemComments8b4ed9Schema> }
}

export interface PlaneUpsertCustomerParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  name: string
  contract_status?: string | null
  description?: string | null
  description_html?: string | null
  domain?: string | null
  email?: string | null
  employees?: number | null
  external_id?: string | null
  external_source?: string | null
  logo_props?: string | null
  revenue?: string | null
  stage?: string | null
  website_url?: string | null
  fields?: string
}
export interface PlaneUpsertCustomerResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2CustomersSchema> }
}

export interface PlaneUpsertCycleParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  description?: string | null
  end_date?: string | null
  external_id?: string | null
  external_source?: string | null
  logo_props?: string | null
  sort_order?: number | null
  start_date?: string | null
  timezone?: string | null
  fields?: string
  expand?: string
}
export interface PlaneUpsertCycleResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Cyclesee71cbSchema> }
}

export interface PlaneUpsertEstimateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  description?: string | null
  external_id?: string | null
  external_source?: string | null
  type?: string | null
  fields?: string
  expand?: string
}
export interface PlaneUpsertEstimateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Estimatesb76797Schema> }
}

export interface PlaneUpsertEstimatePointParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  estimate_id: string
  value: string
  description?: string | null
  external_id?: string | null
  external_source?: string | null
  key?: number | null
  fields?: string
}
export interface PlaneUpsertEstimatePointResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2EstimatePointsSchema> }
}

export interface PlaneUpsertLabelParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  color?: string | null
  description?: string | null
  external_id?: string | null
  external_source?: string | null
  parent_id?: string | null
  sort_order?: number | null
  fields?: string
}
export interface PlaneUpsertLabelResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2LabelsSchema> }
}

export interface PlaneUpsertMilestoneParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  title: string
  external_id?: string | null
  external_source?: string | null
  target_date?: string | null
  fields?: string
}
export interface PlaneUpsertMilestoneResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2MilestonesSchema> }
}

export interface PlaneUpsertModuleParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  description?: string | null
  external_id?: string | null
  external_source?: string | null
  lead_id?: string | null
  logo_props?: string | null
  sort_order?: number | null
  start_date?: string | null
  status?: string | null
  target_date?: string | null
  fields?: string
  expand?: string
}
export interface PlaneUpsertModuleResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Modules0ad45cSchema> }
}

export interface PlaneUpsertProjectParams extends PlaneCredentials {
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
}
export interface PlaneUpsertProjectResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2Projects30f866Schema> }
}

export interface PlaneUpsertStateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  color: string
  name: string
  description?: string | null
  external_id?: string | null
  external_source?: string | null
  group?: string | null
  is_default?: boolean | null
  sequence?: number | null
  fields?: string
}
export interface PlaneUpsertStateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2StatesSchema> }
}

export interface PlaneUpsertWorkItemParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  name: string
  assignee_ids?: unknown[] | string | null
  assignees?: unknown[] | string | null
  cycle_id?: string | null
  description_html?: string | null
  estimate?: string | null
  estimate_point_id?: string | null
  external_id?: string | null
  external_source?: string | null
  label_ids?: unknown[] | string | null
  labels?: unknown[] | string | null
  module_ids?: unknown[] | string | null
  parent?: string | null
  parent_id?: string | null
  priority?: string | null
  start_date?: string | null
  state?: string | null
  state_id?: string | null
  target_date?: string | null
  type?: string | null
  type_id?: string | null
  fields?: string
  expand?: string
}
export interface PlaneUpsertWorkItemResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2WorkItemsa7b6deSchema> }
}

export interface PlaneUseWorkItemTemplateParams extends PlaneCredentials {
  bodyOverrides?: Record<string, unknown> | string
  workspace_slug: string
  project_id: string
  pk: string
  name?: string | null
  new_project_id?: string | null
  fields?: string
  expand?: string
}
export interface PlaneUseWorkItemTemplateResponse extends ToolResponse {
  output: { result: z.output<typeof schemas.planeV2ProjectWorkItemTemplatesa6462fSchema> }
}

export interface PlaneWorkspaceRegenerateNodeWebhookSecretParams extends PlaneCredentials {
  workspace_slug: string
  automation_id: string
  pk: string
}
export interface PlaneWorkspaceRegenerateNodeWebhookSecretResponse extends ToolResponse {
  output: {
    result: z.output<typeof schemas.planeV2V2WorkspaceRegenerateNodeWebhookSecretresultSchema>
  }
}
