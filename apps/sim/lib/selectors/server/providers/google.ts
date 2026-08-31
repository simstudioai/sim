import { getScopesForService } from '@/lib/oauth/utils'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  fetchProviderJson,
  fetchProviderJsonWithStatus,
} from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type GoogleSelectorKey = Extract<
  ServerSelectorKey,
  'google.tasks.lists' | 'gmail.labels' | 'google.calendar' | 'google.drive' | 'google.sheets'
>

interface GoogleTaskList {
  id: string
  title: string
}

interface CalendarListItem {
  id: string
  summary: string
  primary?: boolean
}

function requireGoogleCalendarId(value: string): string {
  const id = value.trim()
  if (!id || id.length > 1_024 || /[\u0000-\u001F\u007F]/.test(id)) {
    throw new SelectorContextUnavailableError()
  }
  return id
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  shortcutDetails?: { targetId?: string }
}

interface GmailLabel {
  id: string
  name: string
  type?: 'system' | 'user'
}

interface Sheet {
  properties: { sheetId: number; title: string; index: number }
}

interface GooglePage<T> {
  items: T[]
  nextCursor?: string
}

async function googleAccessToken(args: ExecuteServerSelectorArgs, serviceId: string) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  try {
    return await resolveSelectorOAuthAccessToken({
      credential: args.credential,
      serviceId,
      scopes: getScopesForService(serviceId),
      impersonateEmail: args.context.impersonateUserEmail,
      protectedValues: args.protectedValues,
    })
  } catch (error) {
    if (error instanceof SelectorConnectionUnavailableError) throw error
    throw new SelectorConnectionUnavailableError()
  }
}

async function fetchGooglePage<T, R extends { nextPageToken?: string }>(input: {
  args: ExecuteServerSelectorArgs
  accessToken: string
  buildUrl(pageToken: string | undefined): URL
  getItems(page: R): T[] | undefined
}): Promise<GooglePage<T>> {
  const request = requireListRequest(input.args.selectorKey, input.args.request)
  const body = await fetchProviderJson<R>(input.buildUrl(request.cursor), {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    signal: input.args.signal,
  })
  const nextCursor = body.nextPageToken?.trim() || undefined
  return {
    items: input.getItems(body) ?? [],
    ...(nextCursor ? { nextCursor } : {}),
  }
}

async function listTaskLists(args: ExecuteServerSelectorArgs): Promise<GooglePage<GoogleTaskList>> {
  const accessToken = await googleAccessToken(args, 'google-tasks')
  return fetchGooglePage<GoogleTaskList, { items?: GoogleTaskList[]; nextPageToken?: string }>({
    args,
    accessToken,
    buildUrl: (pageToken) => {
      const url = new URL('https://tasks.googleapis.com/tasks/v1/users/@me/lists')
      url.searchParams.set('maxResults', '1000')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      return url
    },
    getItems: (page) => page.items,
  })
}

async function executeTaskLists(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    const accessToken = await googleAccessToken(args, 'google-tasks')
    const detailId = requireGoogleId(args.request.id)
    const list = await fetchProviderJson<GoogleTaskList>(
      `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${detailId}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: args.signal }
    )
    return detailSelectorResult(list.id && list.title ? { id: list.id, label: list.title } : null)
  }
  const result = await listTaskLists(args)
  return listSelectorResult(
    result.items
      .filter((list) => list.id && list.title)
      .map((list) => ({
        id: list.id,
        label: list.title,
      })),
    result.nextCursor
  )
}

function gmailLabelName(label: GmailLabel): string {
  if (label.type !== 'system') return label.name
  return label.name.charAt(0).toUpperCase() + label.name.slice(1).toLowerCase()
}

async function executeGmailLabels(args: ExecuteServerSelectorArgs) {
  requireListRequest(args.selectorKey, args.request)
  const accessToken = await googleAccessToken(args, 'gmail')
  const data = await fetchProviderJson<{ labels?: GmailLabel[] }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/labels',
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: args.signal }
  )
  if (!Array.isArray(data.labels)) throw new SelectorOptionsUnavailableError()
  return listSelectorResult(
    data.labels
      .filter((label) => label.id && label.name)
      .map((label) => ({
        id: label.id,
        label: gmailLabelName(label),
      }))
  )
}

async function executeCalendars(args: ExecuteServerSelectorArgs) {
  const accessToken = await googleAccessToken(args, 'google-calendar')
  if (args.request.kind === 'detail') {
    const calendar = await fetchProviderJson<CalendarListItem>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(requireGoogleCalendarId(args.request.id))}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: args.signal }
    )
    return detailSelectorResult({ id: calendar.id, label: calendar.summary })
  }
  requireListRequest(args.selectorKey, args.request)
  const result = await fetchGooglePage<
    CalendarListItem,
    { items?: CalendarListItem[]; nextPageToken?: string }
  >({
    args,
    accessToken,
    buildUrl: (pageToken) => {
      const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList')
      url.searchParams.set('maxResults', '250')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      return url
    },
    getItems: (page) => page.items,
  })
  const calendars = result.items
  calendars.sort((a, b) => {
    if (a.primary && !b.primary) return -1
    if (!a.primary && b.primary) return 1
    return a.summary.localeCompare(b.summary)
  })
  return listSelectorResult(
    calendars
      .filter((calendar) => calendar.id && calendar.summary)
      .map((calendar) => ({
        id: calendar.id,
        label: calendar.summary,
      })),
    result.nextCursor
  )
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function requireGoogleId(value: string | undefined, maxLength = 255): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || trimmed.length > maxLength || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new SelectorContextUnavailableError()
  }
  return trimmed
}

async function fetchSharedDrivePage(
  accessToken: string,
  pageToken: string | undefined,
  signal?: AbortSignal
): Promise<GooglePage<DriveFile>> {
  try {
    const url = new URL('https://www.googleapis.com/drive/v3/drives')
    url.searchParams.set('pageSize', '100')
    url.searchParams.set('fields', 'nextPageToken,drives(id,name)')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const data = await fetchProviderJson<{
      drives?: Array<{ id: string; name: string }>
      nextPageToken?: string
    }>(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal })
    const nextCursor = data.nextPageToken?.trim()
    return {
      items: (data.drives ?? []).map((drive) => ({
        id: drive.id,
        name: drive.name,
        mimeType: 'application/vnd.google-apps.folder',
      })),
      ...(nextCursor ? { nextCursor } : {}),
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return { items: [] }
  }
}

type DriveCursor = { source: 'drives' | 'files'; pageToken?: string }

function parseDriveCursor(cursor: string | undefined): DriveCursor | undefined {
  if (!cursor) return undefined
  const source = cursor.slice(0, 2)
  if (source !== 'd:' && source !== 'f:') throw new SelectorContextUnavailableError()
  const pageToken = cursor.slice(2) || undefined
  return { source: source === 'd:' ? 'drives' : 'files', pageToken }
}

function driveCursor(source: DriveCursor['source'], pageToken?: string): string {
  return `${source === 'drives' ? 'd' : 'f'}:${pageToken ?? ''}`
}

async function listDriveFiles(
  args: ExecuteServerSelectorArgs,
  accessToken: string
): Promise<GooglePage<DriveFile>> {
  const folderId = args.context.fileId?.trim()
  if (folderId) requireGoogleId(folderId, 50)

  const mimeType = args.context.mimeType
  const search = args.request.kind === 'list' ? args.request.search : undefined
  const clauses = ['trashed = false']
  if (folderId) clauses.push(`'${escapeDriveQuery(folderId)}' in parents`)
  if (mimeType) clauses.push(`mimeType = '${escapeDriveQuery(mimeType)}'`)
  if (search) clauses.push(`name contains '${escapeDriveQuery(search)}'`)

  const includeSharedDrives =
    !folderId && mimeType === 'application/vnd.google-apps.folder' && !search
  const request = requireListRequest(args.selectorKey, args.request)
  const cursor = parseDriveCursor(request.cursor)
  if (cursor?.source === 'drives' && !includeSharedDrives) {
    throw new SelectorContextUnavailableError()
  }

  if (includeSharedDrives && (!cursor || cursor.source === 'drives')) {
    const drives = await fetchSharedDrivePage(accessToken, cursor?.pageToken, args.signal)
    if (drives.items.length > 0 || drives.nextCursor) {
      return {
        items: drives.items,
        nextCursor: drives.nextCursor
          ? driveCursor('drives', drives.nextCursor)
          : driveCursor('files'),
      }
    }
  }

  const pageToken = cursor?.source === 'files' ? cursor.pageToken : undefined
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('q', clauses.join(' and '))
  url.searchParams.set('corpora', 'allDrives')
  url.searchParams.set('supportsAllDrives', 'true')
  url.searchParams.set('includeItemsFromAllDrives', 'true')
  url.searchParams.set('pageSize', '100')
  url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType)')
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  const data = await fetchProviderJson<{ files?: DriveFile[]; nextPageToken?: string }>(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: args.signal,
  })
  const nextPageToken = data.nextPageToken?.trim()

  return {
    items: data.files ?? [],
    ...(nextPageToken ? { nextCursor: driveCursor('files', nextPageToken) } : {}),
  }
}

async function fetchDriveDetail(
  args: ExecuteServerSelectorArgs,
  accessToken: string,
  fileId: string
): Promise<DriveFile> {
  const id = requireGoogleId(fileId)
  const headers = { Authorization: `Bearer ${accessToken}` }
  const result = await fetchProviderJsonWithStatus<DriveFile>(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,shortcutDetails&supportsAllDrives=true`,
    { headers, redirect: 'error', signal: args.signal },
    { passthroughStatuses: [404] }
  )

  if (!result.ok) {
    const drive = await fetchProviderJson<{ id: string; name: string }>(
      `https://www.googleapis.com/drive/v3/drives/${id}?fields=id,name`,
      { headers, signal: args.signal }
    )
    return { id: drive.id, name: drive.name, mimeType: 'application/vnd.google-apps.folder' }
  }
  const file = result.data
  const targetId =
    file.mimeType === 'application/vnd.google-apps.shortcut'
      ? file.shortcutDetails?.targetId
      : undefined
  if (!targetId) return file

  let validatedTargetId: string
  try {
    validatedTargetId = requireGoogleId(targetId)
  } catch {
    return file
  }
  try {
    return await fetchProviderJson<DriveFile>(
      `https://www.googleapis.com/drive/v3/files/${validatedTargetId}?fields=id,name,mimeType&supportsAllDrives=true`,
      { headers, signal: args.signal }
    )
  } catch (error) {
    if (args.signal?.aborted) throw error
    return file
  }
}

async function executeDrive(args: ExecuteServerSelectorArgs) {
  const accessToken = await googleAccessToken(args, 'google-drive')
  if (args.request.kind === 'detail') {
    const file = await fetchDriveDetail(args, accessToken, args.request.id)
    if (!file.id || !file.name) throw new SelectorOptionsUnavailableError()
    return detailSelectorResult({ id: file.id, label: file.name })
  }
  const result = await listDriveFiles(args, accessToken)
  return listSelectorResult(
    result.items
      .filter((file) => file.id && file.name)
      .map((file) => ({
        id: file.id,
        label: file.name,
      })),
    result.nextCursor
  )
}

async function executeSheets(args: ExecuteServerSelectorArgs) {
  requireListRequest(args.selectorKey, args.request)
  const spreadsheetId = args.context.spreadsheetId?.trim()
  if (!spreadsheetId) throw new SelectorContextUnavailableError()
  const validatedSpreadsheetId = requireGoogleId(spreadsheetId)

  const accessToken = await googleAccessToken(args, 'google-sheets')
  const data = await fetchProviderJson<{ sheets?: Sheet[] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${validatedSpreadsheetId}?fields=sheets.properties`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: args.signal,
    }
  )
  const sheets = data.sheets ?? []
  sheets.sort((a, b) => a.properties.index - b.properties.index)
  return listSelectorResult(
    sheets
      .filter((sheet) => sheet.properties?.title)
      .map((sheet) => ({
        id: sheet.properties.title,
        label: sheet.properties.title,
      }))
  )
}

const storedCredential = (serviceIds: readonly string[]) =>
  ({ kind: 'stored', field: 'oauthCredential', serviceIds }) as const

export const googleSelectorAttachments = {
  'google.tasks.lists': {
    credential: storedCredential(['google-tasks']),
    destination: 'fixed',
    execute: executeTaskLists,
  },
  'gmail.labels': {
    credential: storedCredential(['gmail']),
    destination: 'fixed',
    execute: executeGmailLabels,
  },
  'google.calendar': {
    credential: storedCredential(['google-calendar']),
    destination: 'fixed',
    execute: executeCalendars,
  },
  'google.drive': {
    credential: storedCredential(['google-drive', 'google-docs', 'google-sheets', 'google-forms']),
    destination: 'fixed',
    execute: executeDrive,
  },
  'google.sheets': {
    credential: storedCredential(['google-sheets']),
    destination: 'fixed',
    execute: executeSheets,
  },
} satisfies ServerSelectorAttachmentMap<GoogleSelectorKey>
