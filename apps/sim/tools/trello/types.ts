import type { OutputProperty, ToolResponse } from '@/tools/types'

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

/** Badge counts Trello shows on the card front; each field is null when Trello omits it. */
export interface TrelloCardBadges {
  votes: number | null
  comments: number | null
  attachments: number | null
  checkItems: number | null
  checkItemsChecked: number | null
  description: boolean | null
  subscribed: boolean | null
  location: boolean | null
  due: string | null
  start: string | null
  dueComplete: boolean | null
}

/** One checklist item; optional fields are null when Trello omits them. */
export interface TrelloCardCheckItem {
  id: string
  name: string
  state: string | null
  pos: number | null
  idChecklist: string | null
  due: string | null
  idMember: string | null
}

/** A card checklist with its items, returned only when checklists are requested. */
export interface TrelloCardChecklist {
  id: string
  name: string
  idCard: string | null
  idBoard: string | null
  pos: number | null
  checkItems: TrelloCardCheckItem[]
}

/** A card attachment, returned only when attachments are requested; metadata fields may be null. */
export interface TrelloCardAttachment {
  id: string
  name: string | null
  url: string | null
  mimeType: string | null
  bytes: number | null
  date: string | null
  idMember: string | null
  isUpload: boolean | null
  pos: number | null
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
  start: string | null
  pos: number | null
  shortUrl: string | null
  shortLink: string | null
  idShort: number | null
  idMembers: string[]
  idChecklists: string[]
  dateLastActivity: string | null
  badges: TrelloCardBadges | null
  checklists: TrelloCardChecklist[] | null
  attachments: TrelloCardAttachment[] | null
  members: TrelloMember[] | null
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
  since?: string
  before?: string
}

export interface TrelloCreateCardParams {
  accessToken: string
  listId: string
  name: string
  desc?: string
  pos?: string
  due?: string
  dueComplete?: boolean
  start?: string
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
  start?: string
  pos?: string
  idBoard?: string
  labelIds?: string[] | string
  memberIds?: string[] | string
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
  includeChecklists?: boolean
  includeAttachments?: boolean
  includeMembers?: boolean
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
  cardsPage?: number
  boardsLimit?: number
  partial?: boolean
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

/** Output schema of a mapped Trello card, shared by the card tools. */
export const TRELLO_CARD_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Card ID' },
  name: { type: 'string', description: 'Card name' },
  desc: { type: 'string', description: 'Card description' },
  url: { type: 'string', description: 'Full card URL' },
  idBoard: { type: 'string', description: 'Board ID containing the card' },
  idList: { type: 'string', description: 'List ID containing the card' },
  closed: { type: 'boolean', description: 'Whether the card is archived' },
  labelIds: {
    type: 'array',
    description: 'Label IDs applied to the card',
    items: {
      type: 'string',
      description: 'A Trello label ID',
    },
  },
  labels: {
    type: 'array',
    description: 'Labels applied to the card',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Label ID' },
        name: { type: 'string', description: 'Label name' },
        color: {
          type: 'string',
          description: 'Label color',
          optional: true,
          nullable: true,
        },
      },
    },
  },
  due: {
    type: 'string',
    description: 'Card due date in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  dueComplete: {
    type: 'boolean',
    description: 'Whether the due date is complete',
    optional: true,
    nullable: true,
  },
  start: {
    type: 'string',
    description: 'Card start date in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  pos: {
    type: 'number',
    description: 'Position of the card in its list',
    optional: true,
    nullable: true,
  },
  shortUrl: {
    type: 'string',
    description: 'Short card URL without the name slug',
    optional: true,
    nullable: true,
  },
  shortLink: {
    type: 'string',
    description: '8-character short card ID',
    optional: true,
    nullable: true,
  },
  idShort: {
    type: 'number',
    description: 'Board-specific numeric card ID (can change when the card moves)',
    optional: true,
    nullable: true,
  },
  idMembers: {
    type: 'array',
    description: 'Member IDs assigned to the card',
    items: { type: 'string', description: 'A Trello member ID' },
  },
  idChecklists: {
    type: 'array',
    description: 'Checklist IDs on the card',
    items: { type: 'string', description: 'A Trello checklist ID' },
  },
  dateLastActivity: {
    type: 'string',
    description: 'When the card last had activity (ISO 8601)',
    optional: true,
    nullable: true,
  },
  badges: {
    type: 'object',
    description: 'Card badge counts shown on the front of the card',
    optional: true,
    nullable: true,
    properties: {
      votes: { type: 'number', description: 'Vote count', optional: true, nullable: true },
      comments: { type: 'number', description: 'Comment count', optional: true, nullable: true },
      attachments: {
        type: 'number',
        description: 'Attachment count',
        optional: true,
        nullable: true,
      },
      checkItems: {
        type: 'number',
        description: 'Total checklist items',
        optional: true,
        nullable: true,
      },
      checkItemsChecked: {
        type: 'number',
        description: 'Completed checklist items',
        optional: true,
        nullable: true,
      },
      description: {
        type: 'boolean',
        description: 'Whether the card has a description',
        optional: true,
        nullable: true,
      },
      subscribed: {
        type: 'boolean',
        description: 'Whether the current member is subscribed',
        optional: true,
        nullable: true,
      },
      location: {
        type: 'boolean',
        description: 'Whether the card has a location',
        optional: true,
        nullable: true,
      },
      due: { type: 'string', description: 'Due date', optional: true, nullable: true },
      start: { type: 'string', description: 'Start date', optional: true, nullable: true },
      dueComplete: {
        type: 'boolean',
        description: 'Whether the due date is complete',
        optional: true,
        nullable: true,
      },
    },
  },
  checklists: {
    type: 'array',
    description: 'Checklists with their items. Only returned when checklists are requested',
    optional: true,
    nullable: true,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Checklist ID' },
        name: { type: 'string', description: 'Checklist name' },
        idCard: { type: 'string', description: 'Card ID', optional: true, nullable: true },
        idBoard: { type: 'string', description: 'Board ID', optional: true, nullable: true },
        pos: { type: 'number', description: 'Checklist position', optional: true, nullable: true },
        checkItems: {
          type: 'array',
          description: 'Checklist items',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Checklist item ID' },
              name: { type: 'string', description: 'Checklist item name' },
              state: {
                type: 'string',
                description: 'complete or incomplete',
                optional: true,
                nullable: true,
              },
              pos: { type: 'number', description: 'Item position', optional: true, nullable: true },
              idChecklist: {
                type: 'string',
                description: 'Checklist ID',
                optional: true,
                nullable: true,
              },
              due: { type: 'string', description: 'Item due date', optional: true, nullable: true },
              idMember: {
                type: 'string',
                description: 'Assigned member ID',
                optional: true,
                nullable: true,
              },
            },
          },
        },
      },
    },
  },
  attachments: {
    type: 'array',
    description: 'Card attachments. Only returned when attachments are requested',
    optional: true,
    nullable: true,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Attachment ID' },
        name: { type: 'string', description: 'Attachment name', optional: true, nullable: true },
        url: { type: 'string', description: 'Attachment URL', optional: true, nullable: true },
        mimeType: {
          type: 'string',
          description: 'Attachment MIME type',
          optional: true,
          nullable: true,
        },
        bytes: {
          type: 'number',
          description: 'File size in bytes',
          optional: true,
          nullable: true,
        },
        date: {
          type: 'string',
          description: 'When the attachment was added',
          optional: true,
          nullable: true,
        },
        idMember: {
          type: 'string',
          description: 'ID of the member who added it',
          optional: true,
          nullable: true,
        },
        isUpload: {
          type: 'boolean',
          description: 'Whether the attachment was uploaded',
          optional: true,
          nullable: true,
        },
        pos: { type: 'number', description: 'Attachment position', optional: true, nullable: true },
      },
    },
  },
  members: {
    type: 'array',
    description: 'Member objects on the card. Only returned when members are requested',
    optional: true,
    nullable: true,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Member ID' },
        fullName: {
          type: 'string',
          description: 'Member full name',
          optional: true,
          nullable: true,
        },
        username: {
          type: 'string',
          description: 'Member username',
          optional: true,
          nullable: true,
        },
      },
    },
  },
}
