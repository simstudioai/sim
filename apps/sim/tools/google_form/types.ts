export interface GoogleFormsResponse {
  responseId?: string
  createTime?: string
  lastSubmittedTime?: string
  answers?: Record<string, unknown>
  respondentEmail?: string
  totalScore?: number
  [key: string]: unknown
}

export interface GoogleFormsResponseList {
  responses?: GoogleFormsResponse[]
  nextPageToken?: string
}

export interface GoogleFormsGetResponsesParams {
  accessToken: string
  formId: string
  responseId?: string
  pageSize?: number
}
