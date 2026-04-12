import type {
  TrelloAction,
  TrelloActionBoardTarget,
  TrelloActionCardTarget,
  TrelloActionListTarget,
  TrelloCard,
  TrelloComment,
  TrelloLabel,
  TrelloList,
  TrelloMember,
} from '@/tools/trello/types'

type TrelloRecord = Record<string, unknown>

export const TRELLO_API_BASE_URL = 'https://api.trello.com/1'

function isRecord(value: unknown): value is TrelloRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRequiredString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  throw new Error(`Trello response is missing required field: ${field}`)
}

function getOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function getOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
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

function getIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim().length > 0) {
      return [item]
    }

    if (isRecord(item) && typeof item.id === 'string' && item.id.trim().length > 0) {
      return [item.id]
    }

    return []
  })
}

function mapTrelloLabel(value: unknown): TrelloLabel | null {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name : '',
    color: getOptionalString(value.color),
  }
}

function mapTrelloMember(value: unknown): TrelloMember | null {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null
  }

  return {
    id: value.id,
    fullName: getOptionalString(value.fullName),
    username: getOptionalString(value.username),
  }
}

function mapActionCardTarget(value: unknown): TrelloActionCardTarget | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    shortLink: getOptionalString(value.shortLink),
    idShort: getOptionalNumber(value.idShort),
    due: getOptionalString(value.due),
  }
}

function mapActionBoardTarget(value: unknown): TrelloActionBoardTarget | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    shortLink: getOptionalString(value.shortLink),
  }
}

function mapActionListTarget(value: unknown): TrelloActionListTarget | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: value.name,
  }
}

export function mapTrelloList(value: unknown): TrelloList {
  if (!isRecord(value)) {
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
  if (!isRecord(value)) {
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
    due: getOptionalString(value.due),
    dueComplete: getOptionalBoolean(value.dueComplete),
  }
}

export function mapTrelloAction(value: unknown): TrelloAction {
  if (!isRecord(value)) {
    throw new Error('Trello returned an invalid action object')
  }

  const data = isRecord(value.data) ? value.data : null

  return {
    id: getRequiredString(value.id, 'id'),
    type: getRequiredString(value.type, 'type'),
    date: getRequiredString(value.date, 'date'),
    idMemberCreator: getRequiredString(value.idMemberCreator, 'idMemberCreator'),
    text: data ? getOptionalString(data.text) : null,
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

  if (isRecord(data)) {
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
