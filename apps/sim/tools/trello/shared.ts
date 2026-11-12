import { toBooleanOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import type {
  TrelloAction,
  TrelloActionBoardTarget,
  TrelloActionCardTarget,
  TrelloActionListTarget,
  TrelloBoard,
  TrelloCard,
  TrelloCardAttachment,
  TrelloCardBadges,
  TrelloCardCheckItem,
  TrelloCardChecklist,
  TrelloChecklist,
  TrelloChecklistItem,
  TrelloComment,
  TrelloLabel,
  TrelloList,
  TrelloMember,
} from '@/tools/trello/types'
import type { OutputProperty } from '@/tools/types'

export const TRELLO_API_BASE_URL = 'https://api.trello.com/1'

export const TRELLO_CARD_OUTPUT_DESCRIPTION =
  'id, name, desc, url, shortUrl, shortLink, idShort, idBoard, idList, closed, pos, labelIds, labels, idMembers, idChecklists, due, start, dueComplete, dateLastActivity, badges, checklists, attachments, members'

const TRELLO_MEMBER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Member ID' },
  fullName: { type: 'string', description: 'Member full name', optional: true },
  username: { type: 'string', description: 'Member username', optional: true },
}

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
        },
      },
    },
  },
  due: {
    type: 'string',
    description: 'Card due date in ISO 8601 format',
    optional: true,
  },
  dueComplete: {
    type: 'boolean',
    description: 'Whether the due date is complete',
    optional: true,
  },
  start: {
    type: 'string',
    description: 'Card start date in ISO 8601 format',
    optional: true,
  },
  pos: { type: 'number', description: 'Position of the card in its list', optional: true },
  shortUrl: { type: 'string', description: 'Short card URL without the name slug', optional: true },
  shortLink: { type: 'string', description: '8-character short card ID', optional: true },
  idShort: {
    type: 'number',
    description: 'Board-specific numeric card ID (can change when the card moves)',
    optional: true,
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
  },
  badges: {
    type: 'object',
    description: 'Card badge counts shown on the front of the card',
    optional: true,
    properties: {
      votes: { type: 'number', description: 'Vote count', optional: true },
      comments: { type: 'number', description: 'Comment count', optional: true },
      attachments: { type: 'number', description: 'Attachment count', optional: true },
      checkItems: { type: 'number', description: 'Total checklist items', optional: true },
      checkItemsChecked: {
        type: 'number',
        description: 'Completed checklist items',
        optional: true,
      },
      description: {
        type: 'boolean',
        description: 'Whether the card has a description',
        optional: true,
      },
      subscribed: {
        type: 'boolean',
        description: 'Whether the current member is subscribed',
        optional: true,
      },
      location: { type: 'boolean', description: 'Whether the card has a location', optional: true },
      due: { type: 'string', description: 'Due date', optional: true },
      start: { type: 'string', description: 'Start date', optional: true },
      dueComplete: {
        type: 'boolean',
        description: 'Whether the due date is complete',
        optional: true,
      },
    },
  },
  checklists: {
    type: 'array',
    description: 'Checklists with their items. Only returned when checklists are requested',
    optional: true,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Checklist ID' },
        name: { type: 'string', description: 'Checklist name' },
        idCard: { type: 'string', description: 'Card ID', optional: true },
        idBoard: { type: 'string', description: 'Board ID', optional: true },
        pos: { type: 'number', description: 'Checklist position', optional: true },
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
              },
              pos: { type: 'number', description: 'Item position', optional: true },
              idChecklist: { type: 'string', description: 'Checklist ID', optional: true },
              due: { type: 'string', description: 'Item due date', optional: true },
              idMember: { type: 'string', description: 'Assigned member ID', optional: true },
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
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Attachment ID' },
        name: { type: 'string', description: 'Attachment name', optional: true },
        url: { type: 'string', description: 'Attachment URL', optional: true },
        mimeType: { type: 'string', description: 'Attachment MIME type', optional: true },
        bytes: { type: 'number', description: 'File size in bytes', optional: true },
        date: { type: 'string', description: 'When the attachment was added', optional: true },
        idMember: {
          type: 'string',
          description: 'ID of the member who added it',
          optional: true,
        },
        isUpload: {
          type: 'boolean',
          description: 'Whether the attachment was uploaded',
          optional: true,
        },
        pos: { type: 'number', description: 'Attachment position', optional: true },
      },
    },
  },
  members: {
    type: 'array',
    description: 'Member objects on the card. Only returned when members are requested',
    optional: true,
    items: {
      type: 'object',
      properties: TRELLO_MEMBER_OUTPUT_PROPERTIES,
    },
  },
}

function getRequiredString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  throw new Error(`Trello response is missing required field: ${field}`)
}

function getNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

function getOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  return null
}

function getOptionalPosition(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null
  }

  return getNumber(value)
}

function mapCardBadges(value: unknown): TrelloCardBadges | null {
  if (!isRecordLike(value)) {
    return null
  }

  return {
    votes: getOptionalNumber(value.votes),
    comments: getOptionalNumber(value.comments),
    attachments: getOptionalNumber(value.attachments),
    checkItems: getOptionalNumber(value.checkItems),
    checkItemsChecked: getOptionalNumber(value.checkItemsChecked),
    description: toBooleanOrNull(value.description),
    subscribed: toBooleanOrNull(value.subscribed),
    location: toBooleanOrNull(value.location),
    due: toStringOrNull(value.due),
    start: toStringOrNull(value.start),
    dueComplete: toBooleanOrNull(value.dueComplete),
  }
}

function mapCardCheckItem(value: unknown): TrelloCardCheckItem | null {
  if (!isRecordLike(value) || typeof value.id !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    state: toStringOrNull(value.state),
    pos: getOptionalPosition(value.pos),
    idChecklist: toStringOrNull(value.idChecklist),
    due: toStringOrNull(value.due),
    idMember: toStringOrNull(value.idMember),
  }
}

function mapCardChecklist(value: unknown): TrelloCardChecklist | null {
  if (!isRecordLike(value) || typeof value.id !== 'string') {
    return null
  }

  const checkItems = Array.isArray(value.checkItems)
    ? value.checkItems
        .map((item) => mapCardCheckItem(item))
        .filter((item): item is TrelloCardCheckItem => item !== null)
    : []

  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    idCard: toStringOrNull(value.idCard),
    idBoard: toStringOrNull(value.idBoard),
    pos: getOptionalPosition(value.pos),
    checkItems,
  }
}

function mapCardAttachment(value: unknown): TrelloCardAttachment | null {
  if (!isRecordLike(value) || typeof value.id !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: toStringOrNull(value.name),
    url: toStringOrNull(value.url),
    mimeType: toStringOrNull(value.mimeType),
    bytes: getOptionalNumber(value.bytes),
    date: toStringOrNull(value.date),
    idMember: toStringOrNull(value.idMember),
    isUpload: toBooleanOrNull(value.isUpload),
    pos: getOptionalPosition(value.pos),
  }
}

function mapOptionalCollection<T>(
  value: unknown,
  mapItem: (item: unknown) => T | null
): T[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  return value.map((item) => mapItem(item)).filter((item): item is T => item !== null)
}

export function getIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim().length > 0) {
      return [item]
    }

    if (isRecordLike(item) && typeof item.id === 'string' && item.id.trim().length > 0) {
      return [item.id]
    }

    return []
  })
}

function mapTrelloLabel(value: unknown): TrelloLabel | null {
  if (!isRecordLike(value) || typeof value.id !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    color: toStringOrNull(value.color),
  }
}

export function mapTrelloMember(value: unknown): TrelloMember | null {
  if (!isRecordLike(value) || typeof value.id !== 'string') {
    return null
  }

  return {
    id: value.id,
    fullName: toStringOrNull(value.fullName),
    username: toStringOrNull(value.username),
  }
}

function mapActionCardTarget(value: unknown): TrelloActionCardTarget | null {
  if (!isRecordLike(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    shortLink: toStringOrNull(value.shortLink),
    idShort: getOptionalNumber(value.idShort),
    due: toStringOrNull(value.due),
  }
}

function mapActionBoardTarget(value: unknown): TrelloActionBoardTarget | null {
  if (!isRecordLike(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    shortLink: toStringOrNull(value.shortLink),
  }
}

function mapActionListTarget(value: unknown): TrelloActionListTarget | null {
  if (!isRecordLike(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: value.name,
  }
}

export function mapTrelloList(value: unknown): TrelloList {
  if (!isRecordLike(value)) {
    throw new Error('Trello returned an invalid list object')
  }

  return {
    id: getRequiredString(value.id, 'id'),
    name: getRequiredString(value.name, 'name'),
    closed: typeof value.closed === 'boolean' ? value.closed : false,
    pos: getNumber(value.pos),
    idBoard: getRequiredString(value.idBoard, 'idBoard'),
  }
}

export function mapTrelloCard(value: unknown): TrelloCard {
  if (!isRecordLike(value)) {
    throw new Error('Trello returned an invalid card object')
  }

  const rawLabels = Array.isArray(value.labels) ? value.labels : []
  const labels = rawLabels
    .map((label) => mapTrelloLabel(label))
    .filter((label): label is TrelloLabel => label !== null)
  const labelIds = getIdArray(value.idLabels)

  if (labelIds.length === 0) {
    labelIds.push(...rawLabels.filter((label): label is string => typeof label === 'string'))
  }

  const badges = mapCardBadges(value.badges)

  return {
    id: getRequiredString(value.id, 'id'),
    name: getRequiredString(value.name, 'name'),
    desc: typeof value.desc === 'string' ? value.desc : '',
    url: getRequiredString(value.url, 'url'),
    idBoard: getRequiredString(value.idBoard, 'idBoard'),
    idList: getRequiredString(value.idList, 'idList'),
    closed: typeof value.closed === 'boolean' ? value.closed : false,
    labelIds,
    labels,
    due: toStringOrNull(value.due),
    dueComplete: toBooleanOrNull(value.dueComplete) ?? badges?.dueComplete ?? null,
    start: toStringOrNull(value.start),
    pos: getOptionalPosition(value.pos),
    shortUrl: toStringOrNull(value.shortUrl),
    shortLink: toStringOrNull(value.shortLink),
    idShort: getOptionalNumber(value.idShort),
    idMembers: getIdArray(value.idMembers),
    idChecklists: getIdArray(value.idChecklists),
    dateLastActivity: toStringOrNull(value.dateLastActivity),
    badges,
    checklists: mapOptionalCollection(value.checklists, mapCardChecklist),
    attachments: mapOptionalCollection(value.attachments, mapCardAttachment),
    members: mapOptionalCollection(value.members, mapTrelloMember),
  }
}

export function mapTrelloBoard(value: unknown): TrelloBoard {
  if (!isRecordLike(value)) {
    throw new Error('Trello returned an invalid board object')
  }

  return {
    id: getRequiredString(value.id, 'id'),
    name: getRequiredString(value.name, 'name'),
    desc: typeof value.desc === 'string' ? value.desc : '',
    url: getRequiredString(value.url, 'url'),
    closed: typeof value.closed === 'boolean' ? value.closed : false,
    idOrganization: toStringOrNull(value.idOrganization),
  }
}

export function mapTrelloChecklist(value: unknown): TrelloChecklist {
  if (!isRecordLike(value)) {
    throw new Error('Trello returned an invalid checklist object')
  }

  return {
    id: getRequiredString(value.id, 'id'),
    name: getRequiredString(value.name, 'name'),
    idCard: getRequiredString(value.idCard, 'idCard'),
    idBoard: toStringOrNull(value.idBoard),
    pos: getNumber(value.pos),
  }
}

export function mapTrelloChecklistItem(value: unknown): TrelloChecklistItem {
  if (!isRecordLike(value)) {
    throw new Error('Trello returned an invalid checklist item object')
  }

  return {
    id: getRequiredString(value.id, 'id'),
    name: getRequiredString(value.name, 'name'),
    state: getRequiredString(value.state, 'state'),
    pos: getNumber(value.pos),
    idChecklist: toStringOrNull(value.idChecklist),
  }
}

export function mapTrelloAction(value: unknown): TrelloAction {
  if (!isRecordLike(value)) {
    throw new Error('Trello returned an invalid action object')
  }

  const data = toRecordOrNull(value.data)

  return {
    id: getRequiredString(value.id, 'id'),
    type: getRequiredString(value.type, 'type'),
    date: getRequiredString(value.date, 'date'),
    idMemberCreator: getRequiredString(value.idMemberCreator, 'idMemberCreator'),
    text: data ? toStringOrNull(data.text) : null,
    memberCreator: mapTrelloMember(value.memberCreator),
    card: data ? mapActionCardTarget(data.card) : null,
    board: data ? mapActionBoardTarget(data.board) : null,
    list: data ? mapActionListTarget(data.list) : null,
  }
}

export function mapTrelloComment(value: unknown): TrelloComment {
  return mapTrelloAction(value)
}

export function extractTrelloErrorMessage(
  response: Response,
  data: unknown,
  fallback: string
): string {
  const parts: string[] = []

  if (isRecordLike(data)) {
    const message = data.message
    const error = data.error

    if (typeof message === 'string' && message.trim().length > 0) {
      parts.push(message)
    }

    if (typeof error === 'string' && error.trim().length > 0 && error !== message) {
      parts.push(error)
    }
  }

  if (parts.length > 0) {
    return `${fallback}: ${parts.join(' - ')}`
  }

  if (response.statusText) {
    return `${fallback}: ${response.status} ${response.statusText}`
  }

  return fallback
}
