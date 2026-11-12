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

export const TRELLO_API_BASE_URL = 'https://api.trello.com/1'

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
