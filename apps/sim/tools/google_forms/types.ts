import type { ToolResponse } from '@/tools/types'

// ============================================
// Common Types
// ============================================

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

export interface GoogleFormsInfo {
  title?: string
  description?: string
  documentTitle?: string
}

export interface GoogleFormsSettings {
  quizSettings?: {
    isQuiz?: boolean
  }
  emailCollectionType?:
    | 'EMAIL_COLLECTION_TYPE_UNSPECIFIED'
    | 'DO_NOT_COLLECT'
    | 'VERIFIED'
    | 'RESPONDER_INPUT'
  [key: string]: unknown
}

export interface GoogleFormsPublishState {
  isPublished?: boolean
  isAcceptingResponses?: boolean
}

export interface GoogleFormsPublishSettings {
  publishState?: GoogleFormsPublishState
}

export interface GoogleFormsItem {
  itemId?: string
  title?: string
  description?: string
  questionItem?: Record<string, unknown>
  questionGroupItem?: Record<string, unknown>
  pageBreakItem?: Record<string, unknown>
  textItem?: Record<string, unknown>
  imageItem?: Record<string, unknown>
  videoItem?: Record<string, unknown>
}

export interface GoogleForm {
  formId?: string
  info?: GoogleFormsInfo
  settings?: GoogleFormsSettings
  items?: GoogleFormsItem[]
  revisionId?: string
  responderUri?: string
  linkedSheetId?: string
  publishSettings?: GoogleFormsPublishSettings
}

export interface GoogleFormsWatch {
  id?: string
  target?: {
    topic?: {
      topicName?: string
    }
  }
  eventType?: 'EVENT_TYPE_UNSPECIFIED' | 'SCHEMA' | 'RESPONSES'
  createTime?: string
  expireTime?: string
  state?: 'STATE_UNSPECIFIED' | 'ACTIVE' | 'SUSPENDED'
  errorType?: string
}

// ============================================
// Get Responses Params
// ============================================

export interface GoogleFormsGetResponsesParams {
  accessToken: string
  formId: string
  responseId?: string
  pageSize?: number
}

// ============================================
// Get Form Params & Response
// ============================================

export interface GoogleFormsGetFormParams {
  accessToken: string
  formId: string
}

export interface GoogleFormsGetFormResponse extends ToolResponse {
  output: {
    formId: string
    title: string | null
    description: string | null
    documentTitle: string | null
    responderUri: string | null
    linkedSheetId: string | null
    revisionId: string | null
    items: GoogleFormsItem[]
    settings: GoogleFormsSettings | null
    publishSettings: GoogleFormsPublishSettings | null
  }
}

// ============================================
// Create Form Params & Response
// ============================================

export interface GoogleFormsCreateFormParams {
  accessToken: string
  title: string
  documentTitle?: string
  unpublished?: boolean
}

export interface GoogleFormsCreateFormResponse extends ToolResponse {
  output: {
    formId: string
    title: string | null
    documentTitle: string | null
    responderUri: string | null
    revisionId: string | null
  }
}

// ============================================
// Batch Update Params & Response
// ============================================

export interface GoogleFormsBatchUpdateRequest {
  updateFormInfo?: {
    info: Partial<GoogleFormsInfo>
    updateMask: string
  }
  updateSettings?: {
    settings: Partial<GoogleFormsSettings>
    updateMask: string
  }
  createItem?: {
    item: GoogleFormsItem
    location: { index: number }
  }
  updateItem?: {
    item: GoogleFormsItem
    location: { index: number }
    updateMask: string
  }
  moveItem?: {
    originalLocation: { index: number }
    newLocation: { index: number }
  }
  deleteItem?: {
    location: { index: number }
  }
}

export interface GoogleFormsBatchUpdateParams {
  accessToken: string
  formId: string
  requests: GoogleFormsBatchUpdateRequest[]
  includeFormInResponse?: boolean
}

export interface GoogleFormsBatchUpdateResponse extends ToolResponse {
  output: {
    replies: Record<string, unknown>[]
    writeControl: {
      requiredRevisionId?: string
      targetRevisionId?: string
    } | null
    form: GoogleForm | null
  }
}

// ============================================
// Set Publish Settings Params & Response
// ============================================

export interface GoogleFormsSetPublishSettingsParams {
  accessToken: string
  formId: string
  isPublished: boolean
  isAcceptingResponses?: boolean
}

export interface GoogleFormsSetPublishSettingsResponse extends ToolResponse {
  output: {
    formId: string
    publishSettings: GoogleFormsPublishSettings
  }
}

// ============================================
// Watch Params & Responses
// ============================================

export interface GoogleFormsCreateWatchParams {
  accessToken: string
  formId: string
  eventType: 'SCHEMA' | 'RESPONSES'
  topicName: string
  watchId?: string
}

export interface GoogleFormsCreateWatchResponse extends ToolResponse {
  output: {
    id: string
    eventType: string
    topicName: string | null
    createTime: string | null
    expireTime: string | null
    state: string | null
  }
}

export interface GoogleFormsListWatchesParams {
  accessToken: string
  formId: string
}

export interface GoogleFormsListWatchesResponse extends ToolResponse {
  output: {
    watches: GoogleFormsWatch[]
  }
}

export interface GoogleFormsDeleteWatchParams {
  accessToken: string
  formId: string
  watchId: string
}

export interface GoogleFormsDeleteWatchResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}

export interface GoogleFormsRenewWatchParams {
  accessToken: string
  formId: string
  watchId: string
}

export interface GoogleFormsRenewWatchResponse extends ToolResponse {
  output: {
    id: string
    eventType: string | null
    expireTime: string | null
    state: string | null
  }
}
