import type { ToolResponse } from '@/tools/types'

export interface TrelloBoard {
  id: string
  name: string
  desc: string
  url: string
  closed: boolean
}

export interface TrelloLabel {
  id: string
  name: string
  color: string | null
}

export interface TrelloMember {
  id: string
  fullName: string | null
  username: string | null
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
  labelIds: string[]
  labels: TrelloLabel[]
  due: string | null
  dueComplete: boolean | null
}

export interface TrelloActionCardTarget {
  id: string
  name: string
  shortLink: string | null
  idShort: number | null
  due: string | null
}

export interface TrelloActionBoardTarget {
  id: string
  name: string
  shortLink: string | null
}

export interface TrelloActionListTarget {
  id: string
  name: string
}

export interface TrelloAction {
  id: string
  type: string
  date: string
  idMemberCreator: string
  text: string | null
  memberCreator: TrelloMember | null
  card: TrelloActionCardTarget | null
  board: TrelloActionBoardTarget | null
  list: TrelloActionListTarget | null
}

export interface TrelloComment extends TrelloAction {}

export interface TrelloListListsParams {
  accessToken: string
  boardId: string
}

export interface TrelloListCardsParams {
  accessToken: string
  boardId?: string
  listId?: string
}

export interface TrelloCreateCardParams {
  accessToken: string
  listId: string
  name: string
  desc?: string
  pos?: string
  due?: string
  dueComplete?: boolean
  labelIds?: string[]
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
  page?: number
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
