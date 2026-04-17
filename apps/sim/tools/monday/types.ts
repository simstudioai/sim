import type { ToolResponse } from '@/tools/types'

export interface MondayBoard {
  id: string
  name: string
  description: string | null
  state: string
  boardKind: string
  itemsCount: number
  url: string
  updatedAt: string | null
}

export interface MondayGroup {
  id: string
  title: string
  color: string
  archived: boolean | null
  deleted: boolean | null
  position: string
}

export interface MondayColumn {
  id: string
  title: string
  type: string
}

export interface MondayColumnValue {
  id: string
  text: string | null
  value: string | null
  type: string
}

export interface MondayItem {
  id: string
  name: string
  state: string | null
  boardId: string | null
  groupId: string | null
  groupTitle: string | null
  columnValues: MondayColumnValue[]
  createdAt: string | null
  updatedAt: string | null
  url: string | null
}

export interface MondayUpdate {
  id: string
  body: string
  textBody: string | null
  createdAt: string | null
  creatorId: string | null
  itemId: string | null
}

export interface MondayListBoardsParams {
  accessToken: string
  limit?: number
  page?: number
}

export interface MondayListBoardsResponse extends ToolResponse {
  output: {
    boards: MondayBoard[]
    count: number
  }
}

export interface MondayGetBoardParams {
  accessToken: string
  boardId: string
}

export interface MondayGetBoardResponse extends ToolResponse {
  output: {
    board: MondayBoard | null
    groups: MondayGroup[]
    columns: MondayColumn[]
  }
}

export interface MondayGetItemsParams {
  accessToken: string
  boardId: string
  groupId?: string
  limit?: number
}

export interface MondayGetItemsResponse extends ToolResponse {
  output: {
    items: MondayItem[]
    count: number
  }
}

export interface MondayCreateItemParams {
  accessToken: string
  boardId: string
  itemName: string
  groupId?: string
  columnValues?: string
}

export interface MondayCreateItemResponse extends ToolResponse {
  output: {
    item: MondayItem | null
  }
}

export interface MondayUpdateItemParams {
  accessToken: string
  boardId: string
  itemId: string
  columnValues: string
}

export interface MondayUpdateItemResponse extends ToolResponse {
  output: {
    item: MondayItem | null
  }
}

export interface MondayDeleteItemParams {
  accessToken: string
  itemId: string
}

export interface MondayDeleteItemResponse extends ToolResponse {
  output: {
    id: string
  }
}

export interface MondayCreateUpdateParams {
  accessToken: string
  itemId: string
  body: string
}

export interface MondayCreateUpdateResponse extends ToolResponse {
  output: {
    update: MondayUpdate | null
  }
}

export interface MondaySearchItemsParams {
  accessToken: string
  boardId: string
  columns: string
  limit?: number
  cursor?: string
}

export interface MondaySearchItemsResponse extends ToolResponse {
  output: {
    items: MondayItem[]
    count: number
    cursor: string | null
  }
}

export interface MondayCreateSubitemParams {
  accessToken: string
  parentItemId: string
  itemName: string
  columnValues?: string
}

export interface MondayCreateSubitemResponse extends ToolResponse {
  output: {
    item: MondayItem | null
  }
}

export interface MondayMoveItemToGroupParams {
  accessToken: string
  itemId: string
  groupId: string
}

export interface MondayMoveItemToGroupResponse extends ToolResponse {
  output: {
    item: MondayItem | null
  }
}

export interface MondayGetItemParams {
  accessToken: string
  itemId: string
}

export interface MondayGetItemResponse extends ToolResponse {
  output: {
    item: MondayItem | null
  }
}

export interface MondayArchiveItemParams {
  accessToken: string
  itemId: string
}

export interface MondayArchiveItemResponse extends ToolResponse {
  output: {
    id: string
  }
}

export interface MondayCreateGroupParams {
  accessToken: string
  boardId: string
  groupName: string
  groupColor?: string
}

export interface MondayCreateGroupResponse extends ToolResponse {
  output: {
    group: MondayGroup | null
  }
}
