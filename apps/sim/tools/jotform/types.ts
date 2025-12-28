import type { ToolResponse } from '@/tools/types'

export interface JotformSubmissionsParams {
  apiKey: string
  formId: string
  limit?: number
  offset?: number
  filter?: string
  orderby?: string
}

export interface JotformSubmissionsResponse extends ToolResponse {
  output: {
    resultSet: Array<{
      id: string
      form_id: string
      ip: string
      created_at: string
      updated_at: string
      status: string
      new: string
      flag: string
      answers: Record<
        string,
        {
          name: string
          order: string
          text: string
          type: string
          answer: string | string[] | Record<string, any>
          prettyFormat?: string
        }
      >
    }>
  }
}

export interface JotformGetFormParams {
  apiKey: string
  formId: string
}

export interface JotformGetFormResponse extends ToolResponse {
  output: {
    id: string
    username: string
    title: string
    height: string
    status: string
    created_at: string
    updated_at: string
    last_submission: string
    new: string
    count: string
    type: string
    favorite: string
    archived: string
    url: string
  }
}

export interface JotformListFormsParams {
  apiKey: string
  offset?: number
  limit?: number
  filter?: string
  orderby?: string
}

export interface JotformListFormsResponse extends ToolResponse {
  output: {
    forms: Array<{
      id: string
      username: string
      title: string
      height: string
      status: string
      created_at: string
      updated_at: string
      last_submission: string
      new: string
      count: string
      type: string
      favorite: string
      archived: string
      url: string
    }>
  }
}
