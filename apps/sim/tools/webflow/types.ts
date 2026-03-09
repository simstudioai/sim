import type { OutputProperty } from '@/tools/types'

/**
 * Output property definitions for Webflow CMS API responses.
 * @see https://developers.webflow.com/data/reference/cms/collection-items
 */

/**
 * Output definition for CMS item field data.
 * Note: Webflow items have dynamic fields based on collection schema.
 * @see https://developers.webflow.com/data/reference/cms/collection-items/get-item
 */
export const WEBFLOW_ITEM_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique item ID' },
  cmsLocaleId: { type: 'string', description: 'CMS locale ID', optional: true },
  lastPublished: { type: 'string', description: 'Last published date (ISO 8601)', optional: true },
  lastUpdated: { type: 'string', description: 'Last updated date (ISO 8601)', optional: true },
  createdOn: { type: 'string', description: 'Creation date (ISO 8601)', optional: true },
  isArchived: { type: 'boolean', description: 'Whether the item is archived', optional: true },
  isDraft: { type: 'boolean', description: 'Whether the item is a draft', optional: true },
  fieldData: {
    type: 'object',
    description: 'Collection-specific field data (varies by collection schema)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete item output definition
 */
export const WEBFLOW_ITEM_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Webflow CMS collection item',
  properties: WEBFLOW_ITEM_OUTPUT_PROPERTIES,
}

/**
 * Output definition for list metadata.
 */
export const WEBFLOW_LIST_METADATA_OUTPUT_PROPERTIES = {
  itemCount: { type: 'number', description: 'Number of items returned' },
  offset: { type: 'number', description: 'Pagination offset', optional: true },
  limit: { type: 'number', description: 'Maximum items per page', optional: true },
} as const satisfies Record<string, OutputProperty>

export interface WebflowBaseParams {
  accessToken: string
  siteId: string
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
