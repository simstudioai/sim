import type { ToolResponse } from '@/tools/types'

/**
 * Monday.com Board
 */
export interface MondayBoard {
  id: string
  name: string
  description?: string
  board_kind: string
  state: string
}

/**
 * Monday.com Column
 */
export interface MondayColumn {
  id: string
  title: string
  type: string
  settings_str?: string
}

/**
 * Monday.com Group
 */
export interface MondayGroup {
  id: string
  title: string
  color: string
}

/**
 * Monday.com Column Value
 */
export interface MondayColumnValue {
  id: string
  title: string
  type: string
  text?: string
  value?: string
}

/**
 * Monday.com Item
 */
export interface MondayItem {
  id: string
  name: string
  board: { id: string }
  group: { id: string }
  column_values: MondayColumnValue[]
  created_at: string
  updated_at: string
}

/**
 * Parameters for creating a Monday.com item
 */
export interface CreateItemParams {
  apiKey: string
  board_id: string
  group_id?: string
  item_name: string
  column_values?: Record<string, any>
}

/**
 * Response from creating a Monday.com item
 */
export interface CreateItemResponse extends ToolResponse {
  output: {
    item?: MondayItem
    item_id?: string
  }
}

/**
 * Parameters for updating a Monday.com item
 */
export interface UpdateItemParams {
  apiKey: string
  item_id: string
  board_id?: string
  column_values: Record<string, any>
}

/**
 * Response from updating a Monday.com item
 */
export interface UpdateItemResponse extends ToolResponse {
  output: {
    item?: MondayItem
    item_id?: string
  }
}

/**
 * Parameters for getting a Monday.com item
 */
export interface GetItemParams {
  apiKey: string
  item_id: string
}

/**
 * Response from getting a Monday.com item
 */
export interface GetItemResponse extends ToolResponse {
  output: {
    item?: MondayItem
  }
}

/**
 * Parameters for listing Monday.com items
 */
export interface ListItemsParams {
  apiKey: string
  board_id: string
  group_id?: string
  limit?: number
}

/**
 * Response from listing Monday.com items
 */
export interface ListItemsResponse extends ToolResponse {
  output: {
    items?: MondayItem[]
  }
}

/**
 * Generic Monday.com response type for blocks
 */
export type MondayResponse = {
  success: boolean
  output: {
    item?: MondayItem
    items?: MondayItem[]
    item_id?: string
  }
  error?: string
}
