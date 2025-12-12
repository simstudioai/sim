import type { ToolResponse } from '@/tools/types'

export interface TypeformFilesParams {
  formId: string
  responseId: string
  fieldId: string
  filename: string
  inline?: boolean
  apiKey: string
}

export interface TypeformFilesResponse extends ToolResponse {
  output: {
    fileUrl: string
    contentType: string
    filename: string
  }
}

export interface TypeformInsightsParams {
  formId: string
  apiKey: string
}

// This is the actual output data structure from the API
export interface TypeformInsightsData {
  fields: Array<{
    dropoffs: number
    id: string
    label: string
    ref: string
    title: string
    type: string
    views: number
  }>
  form: {
    platforms: Array<{
      average_time: number
      completion_rate: number
      platform: string
      responses_count: number
      total_visits: number
      unique_visits: number
    }>
    summary: {
      average_time: number
      completion_rate: number
      responses_count: number
      total_visits: number
      unique_visits: number
    }
  }
}

// The ToolResponse uses a union type to allow either successful data or empty object in error case
export interface TypeformInsightsResponse extends ToolResponse {
  output: TypeformInsightsData | Record<string, never>
}

export interface TypeformResponsesParams {
  formId: string
  apiKey: string
  pageSize?: number
  since?: string
  until?: string
  completed?: string
}

export interface TypeformResponsesResponse extends ToolResponse {
  output: {
    total_items: number
    page_count: number
    items: Array<{
      landing_id: string
      token: string
      landed_at: string
      submitted_at: string
      metadata: {
        user_agent: string
        platform: string
        referer: string
        network_id: string
        browser: string
      }
      answers: Array<{
        field: {
          id: string
          type: string
          ref: string
        }
        type: string
        [key: string]: any
      }>
      hidden: Record<string, any>
      calculated: {
        score: number
      }
      variables: Array<{
        key: string
        type: string
        [key: string]: any
      }>
    }>
  }
}

export interface TypeformListFormsParams {
  apiKey: string
  search?: string
  page?: number
  pageSize?: number
  workspaceId?: string
}

export interface TypeformListFormsResponse extends ToolResponse {
  output: {
    total_items: number
    page_count: number
    items: Array<{
      id: string
      title: string
      created_at: string
      last_updated_at: string
      settings: {
        is_public: boolean
        [key: string]: any
      }
      theme: {
        href: string
      }
      _links: {
        display: string
        responses: string
      }
      [key: string]: any
    }>
  }
}

export interface TypeformGetFormParams {
  apiKey: string
  formId: string
}

export interface TypeformGetFormResponse extends ToolResponse {
  output: {
    id: string
    title: string
    type: string
    created_at: string
    last_updated_at: string
    settings: Record<string, any>
    theme: Record<string, any>
    workspace: {
      href: string
    }
    fields: Array<{
      id: string
      title: string
      type: string
      ref: string
      properties?: Record<string, any>
      validations?: Record<string, any>
      [key: string]: any
    }>
    thankyou_screens?: Array<{
      id: string
      title: string
      ref: string
      properties?: Record<string, any>
      [key: string]: any
    }>
    _links: {
      display: string
      responses: string
    }
    [key: string]: any
  }
}

export interface TypeformCreateFormParams {
  apiKey: string
  title: string
  type?: string
  workspaceId?: string
  fields?: Array<Record<string, any>>
  settings?: Record<string, any>
  themeId?: string
}

export interface TypeformCreateFormResponse extends ToolResponse {
  output: {
    id: string
    title: string
    type: string
    created_at: string
    last_updated_at: string
    settings: Record<string, any>
    theme: Record<string, any>
    workspace?: {
      href: string
    }
    fields: Array<Record<string, any>>
    _links: {
      display: string
      responses: string
    }
    [key: string]: any
  }
}

export interface TypeformUpdateFormParams {
  apiKey: string
  formId: string
  operations: Array<{
    op: 'add' | 'remove' | 'replace'
    path: string
    value?: any
  }>
}

export interface TypeformUpdateFormResponse extends ToolResponse {
  output: {
    id: string
    title: string
    type: string
    created_at: string
    last_updated_at: string
    settings: Record<string, any>
    theme: Record<string, any>
    workspace?: {
      href: string
    }
    fields: Array<Record<string, any>>
    thankyou_screens?: Array<Record<string, any>>
    _links: Record<string, any>
    [key: string]: any
  }
}

export interface TypeformDeleteFormParams {
  apiKey: string
  formId: string
}

export interface TypeformDeleteFormResponse extends ToolResponse {
  output: {
    deleted: boolean
    message: string
  }
}

export interface TypeformResponse extends ToolResponse {
  output:
    | TypeformResponsesResponse['output']
    | TypeformFilesResponse['output']
    | TypeformInsightsData
}
