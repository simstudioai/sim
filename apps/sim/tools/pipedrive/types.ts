import type { ToolResponse } from '@/tools/types'

// Common Pipedrive types
export interface PipedriveLead {
  id: string
  title: string
  person_id?: number
  organization_id?: number
  owner_id: number
  value?: {
    amount: number
    currency: string
  }
  expected_close_date?: string
  is_archived: boolean
  was_seen: boolean
  add_time: string
  update_time: string
}

export interface PipedriveDeal {
  id: number
  title: string
  value: number
  currency: string
  status: string
  stage_id: number
  pipeline_id: number
  person_id?: number
  org_id?: number
  owner_id: number
  add_time: string
  update_time: string
  won_time?: string
  lost_time?: string
  close_time?: string
  expected_close_date?: string
}

export interface PipedriveActivity {
  id: number
  subject: string
  type: string
  due_date: string
  due_time: string
  duration: string
  deal_id?: number
  person_id?: number
  org_id?: number
  done: boolean
  note: string
  add_time: string
  update_time: string
}

export interface PipedriveFile {
  id: number
  name: string
  file_type: string
  file_size: number
  add_time: string
  update_time: string
  deal_id?: number
  person_id?: number
  org_id?: number
  url: string
}

export interface PipedrivePipeline {
  id: number
  name: string
  url_title: string
  order_nr: number
  active: boolean
  deal_probability: boolean
  add_time: string
  update_time: string
}

export interface PipedriveProject {
  id: number
  title: string
  description?: string
  status: string
  owner_id: number
  start_date?: string
  end_date?: string
  add_time: string
  update_time: string
}

export interface PipedriveMailMessage {
  id: number
  subject: string
  snippet: string
  mail_thread_id: number
  from_address: string
  to_addresses: string[]
  cc_addresses?: string[]
  bcc_addresses?: string[]
  timestamp: string
  item_type: string
  deal_id?: number
  person_id?: number
  org_id?: number
}

// GET All Deals
export interface PipedriveGetAllDealsParams {
  accessToken: string
  status?: string
  person_id?: string
  org_id?: string
  pipeline_id?: string
  updated_since?: string
  limit?: string
}

export interface PipedriveGetAllDealsOutput {
  deals: PipedriveDeal[]
  metadata: {
    total_items: number
    has_more: boolean
  }
  success: boolean
}

export interface PipedriveGetAllDealsResponse extends ToolResponse {
  output: PipedriveGetAllDealsOutput
}

// GET Deal
export interface PipedriveGetDealParams {
  accessToken: string
  deal_id: string
}

export interface PipedriveGetDealOutput {
  deal: PipedriveDeal
  success: boolean
}

export interface PipedriveGetDealResponse extends ToolResponse {
  output: PipedriveGetDealOutput
}

// CREATE Deal
export interface PipedriveCreateDealParams {
  accessToken: string
  title: string
  value?: string
  currency?: string
  person_id?: string
  org_id?: string
  pipeline_id?: string
  stage_id?: string
  status?: string
  expected_close_date?: string
}

export interface PipedriveCreateDealOutput {
  deal: PipedriveDeal
  success: boolean
}

export interface PipedriveCreateDealResponse extends ToolResponse {
  output: PipedriveCreateDealOutput
}

// UPDATE Deal
export interface PipedriveUpdateDealParams {
  accessToken: string
  deal_id: string
  title?: string
  value?: string
  status?: string
  stage_id?: string
  expected_close_date?: string
}

export interface PipedriveUpdateDealOutput {
  deal: PipedriveDeal
  success: boolean
}

export interface PipedriveUpdateDealResponse extends ToolResponse {
  output: PipedriveUpdateDealOutput
}

// GET Files
export interface PipedriveGetFilesParams {
  accessToken: string
  deal_id?: string
  person_id?: string
  org_id?: string
  limit?: string
}

export interface PipedriveGetFilesOutput {
  files: PipedriveFile[]
  total_items: number
  success: boolean
}

export interface PipedriveGetFilesResponse extends ToolResponse {
  output: PipedriveGetFilesOutput
}

export interface PipedriveGetMailMessagesParams {
  accessToken: string
  folder?: string
  limit?: string
}

export interface PipedriveGetMailMessagesOutput {
  messages: PipedriveMailMessage[]
  total_items: number
  success: boolean
}

export interface PipedriveGetMailMessagesResponse extends ToolResponse {
  output: PipedriveGetMailMessagesOutput
}

// GET Mail Thread
export interface PipedriveGetMailThreadParams {
  accessToken: string
  thread_id: string
}

export interface PipedriveGetMailThreadOutput {
  messages: PipedriveMailMessage[]
  metadata: {
    thread_id: string
    total_items: number
  }
  success: boolean
}

export interface PipedriveGetMailThreadResponse extends ToolResponse {
  output: PipedriveGetMailThreadOutput
}

// GET All Pipelines
export interface PipedriveGetPipelinesParams {
  accessToken: string
  sort_by?: string
  sort_direction?: string
  limit?: string
  cursor?: string
}

export interface PipedriveGetPipelinesOutput {
  pipelines: PipedrivePipeline[]
  total_items: number
  success: boolean
}

export interface PipedriveGetPipelinesResponse extends ToolResponse {
  output: PipedriveGetPipelinesOutput
}

// GET Pipeline Deals
export interface PipedriveGetPipelineDealsParams {
  accessToken: string
  pipeline_id: string
  stage_id?: string
  status?: string
  limit?: string
}

export interface PipedriveGetPipelineDealsOutput {
  deals: PipedriveDeal[]
  metadata: {
    pipeline_id: string
    total_items: number
  }
  success: boolean
}

export interface PipedriveGetPipelineDealsResponse extends ToolResponse {
  output: PipedriveGetPipelineDealsOutput
}

// GET All Projects (or single project if project_id provided)
export interface PipedriveGetProjectsParams {
  accessToken: string
  project_id?: string
  status?: string
  limit?: string
}

export interface PipedriveGetProjectsOutput {
  projects?: PipedriveProject[]
  project?: PipedriveProject
  total_items?: number
  success: boolean
}

export interface PipedriveGetProjectsResponse extends ToolResponse {
  output: PipedriveGetProjectsOutput
}

// CREATE Project
export interface PipedriveCreateProjectParams {
  accessToken: string
  title: string
  description?: string
  start_date?: string
  end_date?: string
}

export interface PipedriveCreateProjectOutput {
  project: PipedriveProject
  success: boolean
}

export interface PipedriveCreateProjectResponse extends ToolResponse {
  output: PipedriveCreateProjectOutput
}

// GET All Activities
export interface PipedriveGetActivitiesParams {
  accessToken: string
  deal_id?: string
  person_id?: string
  org_id?: string
  type?: string
  done?: string
  limit?: string
}

export interface PipedriveGetActivitiesOutput {
  activities: PipedriveActivity[]
  total_items: number
  success: boolean
}

export interface PipedriveGetActivitiesResponse extends ToolResponse {
  output: PipedriveGetActivitiesOutput
}

// CREATE Activity
export interface PipedriveCreateActivityParams {
  accessToken: string
  subject: string
  type: string
  due_date: string
  due_time?: string
  duration?: string
  deal_id?: string
  person_id?: string
  org_id?: string
  note?: string
}

export interface PipedriveCreateActivityOutput {
  activity: PipedriveActivity
  success: boolean
}

export interface PipedriveCreateActivityResponse extends ToolResponse {
  output: PipedriveCreateActivityOutput
}

// UPDATE Activity
export interface PipedriveUpdateActivityParams {
  accessToken: string
  activity_id: string
  subject?: string
  due_date?: string
  due_time?: string
  duration?: string
  done?: string
  note?: string
}

export interface PipedriveUpdateActivityOutput {
  activity: PipedriveActivity
  success: boolean
}

export interface PipedriveUpdateActivityResponse extends ToolResponse {
  output: PipedriveUpdateActivityOutput
}

// GET Leads
export interface PipedriveGetLeadsParams {
  accessToken: string
  lead_id?: string
  archived?: string
  owner_id?: string
  person_id?: string
  organization_id?: string
  limit?: string
}

export interface PipedriveGetLeadsOutput {
  leads?: PipedriveLead[]
  lead?: PipedriveLead
  total_items?: number
  success: boolean
}

export interface PipedriveGetLeadsResponse extends ToolResponse {
  output: PipedriveGetLeadsOutput
}

// CREATE Lead
export interface PipedriveCreateLeadParams {
  accessToken: string
  title: string
  person_id?: string
  organization_id?: string
  owner_id?: string
  value_amount?: string
  value_currency?: string
  expected_close_date?: string
  visible_to?: string
}

export interface PipedriveCreateLeadOutput {
  lead: PipedriveLead
  success: boolean
}

export interface PipedriveCreateLeadResponse extends ToolResponse {
  output: PipedriveCreateLeadOutput
}

// UPDATE Lead
export interface PipedriveUpdateLeadParams {
  accessToken: string
  lead_id: string
  title?: string
  person_id?: string
  organization_id?: string
  owner_id?: string
  value_amount?: string
  value_currency?: string
  expected_close_date?: string
  is_archived?: string
}

export interface PipedriveUpdateLeadOutput {
  lead: PipedriveLead
  success: boolean
}

export interface PipedriveUpdateLeadResponse extends ToolResponse {
  output: PipedriveUpdateLeadOutput
}

// DELETE Lead
export interface PipedriveDeleteLeadParams {
  accessToken: string
  lead_id: string
}

export interface PipedriveDeleteLeadOutput {
  data: any
  success: boolean
}

export interface PipedriveDeleteLeadResponse extends ToolResponse {
  output: PipedriveDeleteLeadOutput
}

// Union type of all responses
export type PipedriveResponse =
  | PipedriveGetAllDealsResponse
  | PipedriveGetDealResponse
  | PipedriveCreateDealResponse
  | PipedriveUpdateDealResponse
  | PipedriveGetFilesResponse
  | PipedriveGetMailMessagesResponse
  | PipedriveGetMailThreadResponse
  | PipedriveGetPipelinesResponse
  | PipedriveGetPipelineDealsResponse
  | PipedriveGetProjectsResponse
  | PipedriveCreateProjectResponse
  | PipedriveGetActivitiesResponse
  | PipedriveCreateActivityResponse
  | PipedriveUpdateActivityResponse
  | PipedriveGetLeadsResponse
  | PipedriveCreateLeadResponse
  | PipedriveUpdateLeadResponse
  | PipedriveDeleteLeadResponse
