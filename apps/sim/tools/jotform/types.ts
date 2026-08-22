import type { ToolResponse } from '@/tools/types'

/**
 * Jotform returns every scalar as a string, including counts and boolean-ish flags
 * such as `favorite` and `archived`, so the projected shapes keep them as strings
 * rather than coercing to types the API never promised.
 */

/** Credentials and host selection every Jotform tool takes. */
export interface JotformAuthParams {
  apiKey: string
  region?: string
}

export interface JotformForm {
  id: string | null
  username: string | null
  title: string | null
  height: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
  last_submission: string | null
  new: string | null
  count: string | null
  type: string | null
  favorite: string | null
  archived: string | null
  url: string | null
}

/** Question properties vary by field type, so the documented keys are widened. */
export interface JotformQuestion extends Record<string, unknown> {
  qid: string | null
  name: string | null
  order: string | null
  text: string | null
  type: string | null
  required: string | null
}

export interface JotformSubmissionAnswer {
  text: string | null
  type: string | null
  answer: unknown
  prettyFormat: string | null
}

export interface JotformSubmission {
  id: string | null
  form_id: string | null
  ip: string | null
  created_at: string | null
  updated_at: string | null
  status: string | null
  new: string | null
  workflowStatus: string | null
  answers: Record<string, JotformSubmissionAnswer>
  /**
   * Answers re-keyed by question label with each value rendered as text. Labels are
   * not unique, so every occurrence of a repeated label is suffixed with its question
   * id rather than overwriting.
   */
  values: Record<string, string>
}

export interface JotformReport {
  id: string | null
  form_id: string | null
  title: string | null
  fields: string | null
  list_type: string | null
  status: string | null
  url: string | null
  isProtected: boolean | null
  settings: string | null
  created_at: string | null
  updated_at: string | null
}

export interface JotformFile {
  name: string | null
  type: string | null
  size: string | null
  username: string | null
  form_id: string | null
  submission_id: string | null
  date: string | null
  url: string | null
}

export interface JotformPagination {
  offset: number | null
  limit: number | null
  count: number | null
}

export interface JotformListParams extends JotformAuthParams {
  offset?: string
  limit?: string
  orderby?: string
  direction?: string
  filter?: Record<string, unknown> | string
}

export type JotformListFormsParams = JotformListParams

export interface JotformListFormsResponse extends ToolResponse {
  output: {
    forms: JotformForm[]
    pagination: JotformPagination | null
  }
}

export interface JotformGetFormParams extends JotformAuthParams {
  formId: string
}

export interface JotformFormResponse extends ToolResponse {
  output: {
    form: JotformForm
  }
}

export interface JotformCreateFormParams extends JotformAuthParams {
  questions?: unknown[] | string
  properties?: Record<string, unknown> | string
  emails?: unknown[] | string
}

export interface JotformDeleteFormParams extends JotformAuthParams {
  formId: string
}

export interface JotformDeleteFormResponse extends ToolResponse {
  output: {
    form: JotformForm
  }
}

export interface JotformCloneFormParams extends JotformAuthParams {
  formId: string
}

export interface JotformGetFormPropertiesParams extends JotformAuthParams {
  formId: string
  propertyKey?: string
}

export interface JotformFormPropertiesResponse extends ToolResponse {
  output: {
    properties: Record<string, unknown>
  }
}

export interface JotformUpdateFormPropertiesParams extends JotformAuthParams {
  formId: string
  properties: Record<string, unknown> | string
}

export interface JotformGetFormFilesParams extends JotformAuthParams {
  formId: string
}

export interface JotformGetFormFilesResponse extends ToolResponse {
  output: {
    files: JotformFile[]
  }
}

export interface JotformListQuestionsParams extends JotformAuthParams {
  formId: string
}

export interface JotformListQuestionsResponse extends ToolResponse {
  output: {
    questions: JotformQuestion[]
  }
}

export interface JotformGetQuestionParams extends JotformAuthParams {
  formId: string
  questionId: string
}

export interface JotformQuestionResponse extends ToolResponse {
  output: {
    question: JotformQuestion
  }
}

export interface JotformCreateQuestionParams extends JotformAuthParams {
  formId: string
  questionType: string
  text?: string
  order?: string
  name?: string
  questionProperties?: Record<string, unknown> | string
}

export interface JotformUpdateQuestionParams extends JotformAuthParams {
  formId: string
  questionId: string
  text?: string
  order?: string
  name?: string
  questionProperties?: Record<string, unknown> | string
}

export interface JotformUpdateQuestionResponse extends ToolResponse {
  output: {
    question: Record<string, unknown>
  }
}

export interface JotformDeleteQuestionParams extends JotformAuthParams {
  formId: string
  questionId: string
}

export interface JotformMessageResponse extends ToolResponse {
  output: {
    deleted: boolean
    message: string | null
  }
}

export interface JotformListFormSubmissionsParams extends JotformListParams {
  formId: string
}

export interface JotformListSubmissionsResponse extends ToolResponse {
  output: {
    submissions: JotformSubmission[]
    pagination: JotformPagination | null
  }
}

export interface JotformGetSubmissionParams extends JotformAuthParams {
  submissionId: string
}

export interface JotformDeleteSubmissionParams extends JotformAuthParams {
  submissionId: string
}

export interface JotformSubmissionResponse extends ToolResponse {
  output: {
    submission: JotformSubmission
  }
}

export interface JotformCreateSubmissionParams extends JotformAuthParams {
  formId: string
  answers: Record<string, unknown> | string
}

export interface JotformUpdateSubmissionParams extends JotformAuthParams {
  submissionId: string
  answers: Record<string, unknown> | string
}

export interface JotformSubmissionRefResponse extends ToolResponse {
  output: {
    submissionId: string | null
    url: string | null
  }
}

export type JotformListReportsParams = JotformAuthParams

export interface JotformListFormReportsParams extends JotformAuthParams {
  formId: string
}

export interface JotformListReportsResponse extends ToolResponse {
  output: {
    reports: JotformReport[]
  }
}

export interface JotformCreateReportParams extends JotformAuthParams {
  formId: string
  title: string
  listType: string
  fields?: string
}

export interface JotformGetReportParams extends JotformAuthParams {
  reportId: string
}

export interface JotformReportResponse extends ToolResponse {
  output: {
    report: JotformReport
  }
}

export interface JotformDeleteReportParams extends JotformAuthParams {
  reportId: string
}

export interface JotformListWebhooksParams extends JotformAuthParams {
  formId: string
}

export interface JotformWebhooksResponse extends ToolResponse {
  output: {
    webhooks: Array<{ id: string; url: string }>
  }
}

export interface JotformCreateWebhookParams extends JotformAuthParams {
  formId: string
  webhookUrl: string
}

export interface JotformDeleteWebhookParams extends JotformAuthParams {
  formId: string
  webhookId: string
}

export type JotformGetUserParams = JotformAuthParams

export interface JotformUser {
  username: string | null
  name: string | null
  email: string | null
  website: string | null
  time_zone: string | null
  account_type: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
  is_verified: string | null
  industry: string | null
  company: string | null
  language: string | null
  avatarUrl: string | null
  usage: string | null
}

export interface JotformGetUserResponse extends ToolResponse {
  output: {
    user: JotformUser
  }
}

export type JotformGetUsageParams = JotformAuthParams

export interface JotformGetUsageResponse extends ToolResponse {
  output: {
    usage: {
      submissions: string | null
      ssl_submissions: string | null
      payments: string | null
      uploads: string | null
      mobile_submissions: string | null
      views: string | null
      api: string | null
    }
  }
}

export interface JotformGetHistoryParams extends JotformAuthParams {
  action?: string
  date?: string
  sortBy?: string
  startDate?: string
  endDate?: string
}

export interface JotformHistoryEntry {
  type: string | null
  formID: string | null
  username: string | null
  formTitle: string | null
  formStatus: string | null
  ip: string | null
  timestamp: string | null
}

export interface JotformGetHistoryResponse extends ToolResponse {
  output: {
    history: JotformHistoryEntry[]
  }
}

export interface JotformCreateSubmissionsParams extends JotformAuthParams {
  formId: string
  submissions: unknown[] | string
}

export interface JotformCreateSubmissionsResponse extends ToolResponse {
  output: {
    submissions: Array<{ submissionId: string | null; url: string | null }>
    count: number
  }
}

export interface JotformCreateQuestionsParams extends JotformAuthParams {
  formId: string
  questions: unknown[] | string
}

export interface JotformSubUserPermission {
  type: string | null
  resource_id: string | null
  access_type: string | null
  title: string | null
}

export interface JotformSubUser {
  username: string | null
  email: string | null
  owner: string | null
  status: string | null
  created_at: string | null
  permissions: JotformSubUserPermission[]
}

export type JotformListSubUsersParams = JotformAuthParams

export interface JotformListSubUsersResponse extends ToolResponse {
  output: {
    subusers: JotformSubUser[]
  }
}

export interface JotformGetSettingsParams extends JotformAuthParams {
  settingsKey?: string
}

export interface JotformUpdateSettingsParams extends JotformAuthParams {
  settingsName?: string
  email?: string
  website?: string
  timeZone?: string
  company?: string
  industry?: string
}

export interface JotformUserResponse extends ToolResponse {
  output: {
    user: JotformUser
  }
}

export interface JotformLabel {
  id: string | null
  name: string | null
  order: string | null
  color: string | null
  owner: string | null
  ownerType: string | null
  parent_label_id: string | null
  created_at: string | null
  updated_at: string | null
}

/** A label plus the labels nested beneath it, as `GET /user/labels` returns them. */
export interface JotformLabelNode extends JotformLabel {
  sublabels: JotformLabelNode[]
}

export interface JotformLabelResource {
  id: string | null
  username: string | null
  title: string | null
  status: string | null
  assetType: string | null
  type: string | null
  labels: string | null
  created_at: string | null
  updated_at: string | null
}

export interface JotformListLabelsParams extends JotformAuthParams {
  addResources?: string
}

export interface JotformListLabelsResponse extends ToolResponse {
  output: {
    labels: JotformLabelNode[]
  }
}

export interface JotformGetLabelParams extends JotformAuthParams {
  labelId: string
}

export interface JotformLabelResponse extends ToolResponse {
  output: {
    label: JotformLabel
  }
}

export interface JotformCreateLabelParams extends JotformAuthParams {
  labelName: string
  color?: string
  parent?: string
}

export interface JotformUpdateLabelParams extends JotformAuthParams {
  labelId: string
  labelName?: string
  color?: string
}

export interface JotformUpdateLabelResponse extends ToolResponse {
  output: {
    label: Record<string, unknown>
  }
}

export interface JotformDeleteLabelParams extends JotformAuthParams {
  labelId: string
}

export interface JotformListLabelResourcesParams extends JotformAuthParams {
  labelId: string
  offset?: string
  limit?: string
  orderby?: string
  status?: string
}

export interface JotformListLabelResourcesResponse extends ToolResponse {
  output: {
    resources: JotformLabelResource[]
  }
}

export interface JotformLabelResourcesParams extends JotformAuthParams {
  labelId: string
  resources: unknown[] | string
}

export interface JotformLabelResourceRefsResponse extends ToolResponse {
  output: {
    resources: Array<{ id: string | null; type: string | null }>
  }
}
