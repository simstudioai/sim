export interface WebflowBaseParams {
  accessToken: string
  collectionId: string
}

export interface WebflowListItemsParams extends WebflowBaseParams {
  offset?: number
  limit?: number
}

export interface WebflowListItemsOutput {
  items: any[]
  metadata: {
    itemCount: number
    offset?: number
    limit?: number
  }
}

export interface WebflowListItemsResponse {
  success: boolean
  output: WebflowListItemsOutput
}

export interface WebflowGetItemParams extends WebflowBaseParams {
  itemId: string
}

export interface WebflowGetItemOutput {
  item: any
  metadata: {
    itemId: string
  }
}

export interface WebflowGetItemResponse {
  success: boolean
  output: WebflowGetItemOutput
}

export interface WebflowCreateItemParams extends WebflowBaseParams {
  fieldData: Record<string, any>
}

export interface WebflowCreateItemOutput {
  item: any
  metadata: {
    itemId: string
  }
}

export interface WebflowCreateItemResponse {
  success: boolean
  output: WebflowCreateItemOutput
}

export interface WebflowUpdateItemParams extends WebflowBaseParams {
  itemId: string
  fieldData: Record<string, any>
}

export interface WebflowUpdateItemOutput {
  item: any
  metadata: {
    itemId: string
  }
}

export interface WebflowUpdateItemResponse {
  success: boolean
  output: WebflowUpdateItemOutput
}

export interface WebflowDeleteItemParams extends WebflowBaseParams {
  itemId: string
}

export interface WebflowDeleteItemOutput {
  success: boolean
  metadata: {
    deleted: boolean
  }
}

export interface WebflowDeleteItemResponse {
  success: boolean
  output: WebflowDeleteItemOutput
}

export type WebflowResponse =
  | WebflowListItemsResponse
  | WebflowGetItemResponse
  | WebflowCreateItemResponse
  | WebflowUpdateItemResponse
  | WebflowDeleteItemResponse
