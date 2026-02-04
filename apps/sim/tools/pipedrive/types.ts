import type { OutputProperty, ToolFileData, ToolResponse } from '@/tools/types'

/**
 * Output property definitions for Pipedrive API responses.
 * @see https://developers.pipedrive.com/docs/api/v1
 */

/**
 * Output definition for lead value objects.
 * @see https://developers.pipedrive.com/docs/api/v1/Leads
 */
export const PIPEDRIVE_LEAD_VALUE_OUTPUT_PROPERTIES = {
  amount: { type: 'number', description: 'Value amount' },
  currency: { type: 'string', description: 'Currency code (e.g., USD, EUR)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for lead objects.
 * @see https://developers.pipedrive.com/docs/api/v1/Leads
 */
export const PIPEDRIVE_LEAD_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Lead ID (UUID)' },
  title: { type: 'string', description: 'Lead title' },
  person_id: { type: 'number', description: 'ID of the associated person', optional: true },
  organization_id: {
    type: 'number',
    description: 'ID of the associated organization',
    optional: true,
  },
  owner_id: { type: 'number', description: 'ID of the lead owner' },
  value: {
    type: 'object',
    description: 'Lead value',
    optional: true,
    properties: PIPEDRIVE_LEAD_VALUE_OUTPUT_PROPERTIES,
  },
  expected_close_date: {
    type: 'string',
    description: 'Expected close date (YYYY-MM-DD)',
    optional: true,
  },
  is_archived: { type: 'boolean', description: 'Whether the lead is archived' },
  was_seen: { type: 'boolean', description: 'Whether the lead was seen' },
  add_time: { type: 'string', description: 'When the lead was created (ISO 8601)' },
  update_time: { type: 'string', description: 'When the lead was last updated (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete lead output definition
 */
export const PIPEDRIVE_LEAD_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pipedrive lead object',
  properties: PIPEDRIVE_LEAD_OUTPUT_PROPERTIES,
}

/**
 * Output definition for deal objects.
 * @see https://developers.pipedrive.com/docs/api/v1/Deals
 */
export const PIPEDRIVE_DEAL_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Deal ID' },
  title: { type: 'string', description: 'Deal title' },
  value: { type: 'number', description: 'Deal value' },
  currency: { type: 'string', description: 'Currency code' },
  status: { type: 'string', description: 'Deal status (open, won, lost, deleted)' },
  stage_id: { type: 'number', description: 'Pipeline stage ID' },
  pipeline_id: { type: 'number', description: 'Pipeline ID' },
  person_id: { type: 'number', description: 'Associated person ID', optional: true },
  org_id: { type: 'number', description: 'Associated organization ID', optional: true },
  owner_id: { type: 'number', description: 'Deal owner user ID' },
  add_time: { type: 'string', description: 'When the deal was created (ISO 8601)' },
  update_time: { type: 'string', description: 'When the deal was last updated (ISO 8601)' },
  won_time: { type: 'string', description: 'When the deal was won', optional: true },
  lost_time: { type: 'string', description: 'When the deal was lost', optional: true },
  close_time: { type: 'string', description: 'When the deal was closed', optional: true },
  expected_close_date: { type: 'string', description: 'Expected close date', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete deal output definition
 */
export const PIPEDRIVE_DEAL_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pipedrive deal object',
  properties: PIPEDRIVE_DEAL_OUTPUT_PROPERTIES,
}

/**
 * Output definition for activity objects.
 * @see https://developers.pipedrive.com/docs/api/v1/Activities
 */
export const PIPEDRIVE_ACTIVITY_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Activity ID' },
  subject: { type: 'string', description: 'Activity subject' },
  type: { type: 'string', description: 'Activity type (call, meeting, task, etc.)' },
  due_date: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
  due_time: { type: 'string', description: 'Due time (HH:MM)' },
  duration: { type: 'string', description: 'Duration (HH:MM)' },
  deal_id: { type: 'number', description: 'Associated deal ID', optional: true },
  person_id: { type: 'number', description: 'Associated person ID', optional: true },
  org_id: { type: 'number', description: 'Associated organization ID', optional: true },
  done: { type: 'boolean', description: 'Whether the activity is done' },
  note: { type: 'string', description: 'Activity note' },
  add_time: { type: 'string', description: 'When the activity was created' },
  update_time: { type: 'string', description: 'When the activity was last updated' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete activity output definition
 */
export const PIPEDRIVE_ACTIVITY_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pipedrive activity object',
  properties: PIPEDRIVE_ACTIVITY_OUTPUT_PROPERTIES,
}

/**
 * Output definition for file objects.
 * @see https://developers.pipedrive.com/docs/api/v1/Files
 */
export const PIPEDRIVE_FILE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'File ID' },
  name: { type: 'string', description: 'File name' },
  file_type: { type: 'string', description: 'File type/extension' },
  file_size: { type: 'number', description: 'File size in bytes' },
  add_time: { type: 'string', description: 'When the file was uploaded' },
  update_time: { type: 'string', description: 'When the file was last updated' },
  deal_id: { type: 'number', description: 'Associated deal ID', optional: true },
  person_id: { type: 'number', description: 'Associated person ID', optional: true },
  org_id: { type: 'number', description: 'Associated organization ID', optional: true },
  url: { type: 'string', description: 'File download URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete file output definition
 */
export const PIPEDRIVE_FILE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pipedrive file object',
  properties: PIPEDRIVE_FILE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for pipeline objects.
 * @see https://developers.pipedrive.com/docs/api/v1/Pipelines
 */
export const PIPEDRIVE_PIPELINE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Pipeline ID' },
  name: { type: 'string', description: 'Pipeline name' },
  url_title: { type: 'string', description: 'URL-friendly title' },
  order_nr: { type: 'number', description: 'Pipeline order number' },
  active: { type: 'boolean', description: 'Whether the pipeline is active' },
  deal_probability: { type: 'boolean', description: 'Whether deal probability is enabled' },
  add_time: { type: 'string', description: 'When the pipeline was created' },
  update_time: { type: 'string', description: 'When the pipeline was last updated' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete pipeline output definition
 */
export const PIPEDRIVE_PIPELINE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pipedrive pipeline object',
  properties: PIPEDRIVE_PIPELINE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for project objects.
 * @see https://developers.pipedrive.com/docs/api/v1/Projects
 */
export const PIPEDRIVE_PROJECT_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Project ID' },
  title: { type: 'string', description: 'Project title' },
  description: { type: 'string', description: 'Project description', optional: true },
  status: { type: 'string', description: 'Project status' },
  owner_id: { type: 'number', description: 'Project owner user ID' },
  start_date: { type: 'string', description: 'Project start date', optional: true },
  end_date: { type: 'string', description: 'Project end date', optional: true },
  add_time: { type: 'string', description: 'When the project was created' },
  update_time: { type: 'string', description: 'When the project was last updated' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete project output definition
 */
export const PIPEDRIVE_PROJECT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pipedrive project object',
  properties: PIPEDRIVE_PROJECT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for mail message objects.
 * @see https://developers.pipedrive.com/docs/api/v1/Mailbox
 */
export const PIPEDRIVE_MAIL_MESSAGE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Message ID' },
  subject: { type: 'string', description: 'Email subject' },
  snippet: { type: 'string', description: 'Email snippet/preview' },
  mail_thread_id: { type: 'number', description: 'Mail thread ID' },
  from_address: { type: 'string', description: 'Sender email address' },
  to_addresses: {
    type: 'array',
    description: 'Recipient email addresses',
    items: { type: 'string', description: 'Email address' },
  },
  cc_addresses: {
    type: 'array',
    description: 'CC email addresses',
    optional: true,
    items: { type: 'string', description: 'Email address' },
  },
  bcc_addresses: {
    type: 'array',
    description: 'BCC email addresses',
    optional: true,
    items: { type: 'string', description: 'Email address' },
  },
  timestamp: { type: 'string', description: 'Message timestamp' },
  item_type: { type: 'string', description: 'Item type' },
  deal_id: { type: 'number', description: 'Associated deal ID', optional: true },
  person_id: { type: 'number', description: 'Associated person ID', optional: true },
  org_id: { type: 'number', description: 'Associated organization ID', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete mail message output definition
 */
export const PIPEDRIVE_MAIL_MESSAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pipedrive mail message object',
  properties: PIPEDRIVE_MAIL_MESSAGE_OUTPUT_PROPERTIES,
}

/**
 * List metadata output properties
 */
export const PIPEDRIVE_METADATA_OUTPUT_PROPERTIES = {
  total_items: { type: 'number', description: 'Total number of items' },
  has_more: { type: 'boolean', description: 'Whether more items are available', optional: true },
} as const satisfies Record<string, OutputProperty>

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
  downloadFiles?: boolean
}

export interface PipedriveGetFilesOutput {
  files: PipedriveFile[]
  downloadedFiles?: ToolFileData[]
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
