import type { ToolResponse } from '@/tools/types'

export interface TrelloBoard {
  id: string
  name: string
  desc: string
  url: string
  closed: boolean
  idOrganization: string | null
}

export interface TrelloChecklist {
  id: string
  name: string
  idCard: string
  idBoard: string | null
  pos: number
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
  filter?: string
}

export interface TrelloListCardsParams {
  accessToken: string
  boardId?: string
  listId?: string
  filter?: string
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
  memberIds?: string[]
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

export interface TrelloDeleteCardParams {
  accessToken: string
  cardId: string
}

export interface TrelloGetActionsParams {
  accessToken: string
  boardId?: string
  cardId?: string
  filter?: string
  limit?: number
  page?: number
  since?: string
  before?: string
}

export interface TrelloAddCommentParams {
  accessToken: string
  cardId: string
  text: string
}

export interface TrelloCreateBoardParams {
  accessToken: string
  name: string
  desc?: string
  idOrganization?: string
  defaultLists?: boolean
}

export interface TrelloGetBoardParams {
  accessToken: string
  boardId: string
}

export interface TrelloCreateListParams {
  accessToken: string
  boardId: string
  name: string
  pos?: string
}

export interface TrelloGetCardParams {
  accessToken: string
  cardId: string
}

export interface TrelloAddChecklistParams {
  accessToken: string
  cardId: string
  name: string
  pos?: string
}

export interface TrelloAddChecklistItemParams {
  accessToken: string
  checklistId: string
  name: string
  pos?: string
  checked?: boolean
}

export interface TrelloUpdateChecklistItemParams {
  accessToken: string
  cardId: string
  checkItemId: string
  state?: 'complete' | 'incomplete'
  name?: string
}

export interface TrelloAddLabelParams {
  accessToken: string
  cardId: string
  labelId: string
}

export interface TrelloRemoveLabelParams {
  accessToken: string
  cardId: string
  labelId: string
}

export interface TrelloAddMemberParams {
  accessToken: string
  cardId: string
  memberId: string
}

export interface TrelloRemoveMemberParams {
  accessToken: string
  cardId: string
  memberId: string
}

export interface TrelloListMembersParams {
  accessToken: string
  boardId: string
}

export interface TrelloUpdateListParams {
  accessToken: string
  listId: string
  name?: string
  closed?: boolean
  idBoard?: string
  pos?: string
}

export interface TrelloSearchParams {
  accessToken: string
  query: string
  idBoards?: string[]
  modelTypes?: string
  cardsLimit?: number
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

export interface TrelloCreateBoardResponse extends ToolResponse {
  output: {
    board?: TrelloBoard
    error?: string
  }
}

export interface TrelloGetBoardResponse extends ToolResponse {
  output: {
    board?: TrelloBoard
    error?: string
  }
}

export interface TrelloCreateListResponse extends ToolResponse {
  output: {
    list?: TrelloList
    error?: string
  }
}

export interface TrelloGetCardResponse extends ToolResponse {
  output: {
    card?: TrelloCard
    error?: string
  }
}

export interface TrelloAddChecklistResponse extends ToolResponse {
  output: {
    checklist?: TrelloChecklist
    error?: string
  }
}

export interface TrelloChecklistItem {
  id: string
  name: string
  state: string
  pos: number
  idChecklist: string | null
}

export interface TrelloAddChecklistItemResponse extends ToolResponse {
  output: {
    item?: TrelloChecklistItem
    error?: string
  }
}

export interface TrelloUpdateChecklistItemResponse extends ToolResponse {
  output: {
    item?: TrelloChecklistItem
    error?: string
  }
}

export interface TrelloAddLabelResponse extends ToolResponse {
  output: {
    labelIds: string[]
    error?: string
  }
}

export interface TrelloRemoveLabelResponse extends ToolResponse {
  output: {
    success: boolean
    error?: string
  }
}

export interface TrelloAddMemberResponse extends ToolResponse {
  output: {
    memberIds: string[]
    error?: string
  }
}

export interface TrelloRemoveMemberResponse extends ToolResponse {
  output: {
    success: boolean
    error?: string
  }
}

export interface TrelloListMembersResponse extends ToolResponse {
  output: {
    members: TrelloMember[]
    count: number
    error?: string
  }
}

export interface TrelloUpdateListResponse extends ToolResponse {
  output: {
    list?: TrelloList
    error?: string
  }
}

export interface TrelloDeleteCardResponse extends ToolResponse {
  output: {
    success: boolean
    error?: string
  }
}

export interface TrelloSearchResponse extends ToolResponse {
  output: {
    cards: TrelloCard[]
    boards: TrelloBoard[]
    count: number
    error?: string
  }
}

export type TrelloResponse =
  | TrelloListListsResponse
  | TrelloListCardsResponse
  | TrelloCreateCardResponse
  | TrelloUpdateCardResponse
  | TrelloDeleteCardResponse
  | TrelloGetActionsResponse
  | TrelloAddCommentResponse
  | TrelloCreateBoardResponse
  | TrelloGetBoardResponse
  | TrelloCreateListResponse
  | TrelloUpdateListResponse
  | TrelloGetCardResponse
  | TrelloAddChecklistResponse
  | TrelloAddChecklistItemResponse
  | TrelloUpdateChecklistItemResponse
  | TrelloAddLabelResponse
  | TrelloRemoveLabelResponse
  | TrelloAddMemberResponse
  | TrelloRemoveMemberResponse
  | TrelloListMembersResponse
  | TrelloSearchResponse
