import type { ToolResponse } from '@/tools/types'

export interface TrelloBoard {
  id: string
  name: string
  desc: string
  url: string
  closed: boolean
}

export interface TrelloList {
  id: string
  name: string
  closed: boolean
  pos: number
  idBoard: string
}

export interface TrelloCard {
  id: string
  name: string
  desc: string
  url: string
  idBoard: string
  idList: string
  closed: boolean
  labels: Array<{
    id: string
    name: string
    color: string
  }>
  due?: string
  dueComplete?: boolean
}

export interface TrelloAction {
  id: string
  type: string
  date: string
  memberCreator: {
    id: string
    fullName: string
    username: string
  }
  data: Record<string, any>
}

export interface TrelloComment {
  id: string
  text: string
  date: string
  memberCreator: {
    id: string
    fullName: string
    username: string
  }
}

export interface TrelloListListsParams {
  accessToken: string
  boardId: string
}

export interface TrelloListCardsParams {
  accessToken: string
  boardId: string
  listId?: string
}

export interface TrelloCreateCardParams {
  accessToken: string
  boardId: string
  listId: string
  name: string
  desc?: string
  pos?: string
  due?: string
  labels?: string
}

export interface TrelloUpdateCardParams {
  accessToken: string
  cardId: string
  name?: string
  desc?: string
  closed?: boolean
  idList?: string
  due?: string
  dueComplete?: boolean
}

export interface TrelloGetActionsParams {
  accessToken: string
  boardId?: string
  cardId?: string
  filter?: string
  limit?: number
}

export interface TrelloAddCommentParams {
  accessToken: string
  cardId: string
  text: string
}

export interface TrelloListListsResponse extends ToolResponse {
  output: {
    lists: TrelloList[]
    count: number
    error?: string
  }
}

export interface TrelloListCardsResponse extends ToolResponse {
  output: {
    cards: TrelloCard[]
    count: number
    error?: string
  }
}

export interface TrelloCreateCardResponse extends ToolResponse {
  output: {
    card?: TrelloCard
    error?: string
  }
}

export interface TrelloUpdateCardResponse extends ToolResponse {
  output: {
    card?: TrelloCard
    error?: string
  }
}

export interface TrelloGetActionsResponse extends ToolResponse {
  output: {
    actions: TrelloAction[]
    count: number
    error?: string
  }
}

export interface TrelloAddCommentResponse extends ToolResponse {
  output: {
    comment?: TrelloComment
    error?: string
  }
}

export type TrelloResponse =
  | TrelloListListsResponse
  | TrelloListCardsResponse
  | TrelloCreateCardResponse
  | TrelloUpdateCardResponse
  | TrelloGetActionsResponse
  | TrelloAddCommentResponse
