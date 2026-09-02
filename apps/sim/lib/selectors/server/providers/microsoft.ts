import {
  validateMicrosoftGraphId,
  validatePathSegment,
  validateSharePointSiteId,
} from '@/lib/core/security/input-validation'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
} from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  SelectorCredentialPolicy,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import {
  detailSelectorResult,
  listSelectorResult,
  requireListRequest,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { GRAPH_ID_PATTERN, getItemBasePath } from '@/tools/microsoft_excel/utils'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'

type MicrosoftSelectorKey = Extract<
  ServerSelectorKey,
  | 'microsoft.planner.plans'
  | 'outlook.folders'
  | 'outlook.calendars'
  | 'microsoft.teams'
  | 'microsoft.chats'
  | 'microsoft.channels'
  | 'microsoft.planner'
  | 'onedrive.files'
  | 'onedrive.folders'
  | 'microsoft.excel.sheets'
  | 'microsoft.excel.drives'
  | 'microsoft.excel'
  | 'microsoft.word'
>

const CHAT_LABEL_CONCURRENCY = 10

function microsoftCredential(serviceId: string): SelectorCredentialPolicy {
  return { kind: 'stored', field: 'oauthCredential', serviceIds: [serviceId] }
}

async function graphToken(args: ExecuteServerSelectorArgs, serviceId: string): Promise<string> {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId,
    protectedValues: args.protectedValues,
  })
}

interface GraphPage<T> {
  items: T[]
  nextCursor?: string
}

function graphPageUrl(cursor: string | undefined, initialUrl: string): string {
  if (!cursor) return initialUrl
  let cursorUrl: string
  try {
    cursorUrl = assertGraphNextPageUrl(cursor)
  } catch {
    throw new SelectorContextUnavailableError()
  }
  if (new URL(cursorUrl).pathname !== new URL(initialUrl).pathname) {
    throw new SelectorContextUnavailableError()
  }
  return cursorUrl
}

async function fetchGraphPage<T>(input: {
  args: ExecuteServerSelectorArgs
  serviceId: string
  initialUrl: string
  token?: string
  includeItem?(item: T): boolean
}): Promise<GraphPage<T>> {
  const request = requireListRequest(input.args.selectorKey, input.args.request)
  const token = input.token ?? (await graphToken(input.args, input.serviceId))
  const data = await fetchProviderJson<{ value?: T[] } & Record<string, unknown>>(
    graphPageUrl(request.cursor, input.initialUrl),
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: input.args.signal,
      redirect: 'error',
    }
  )
  const values = Array.isArray(data.value)
    ? input.includeItem
      ? data.value.filter(input.includeItem)
      : data.value
    : []
  const nextLink = getGraphNextPageUrl(data)
  const nextCursor = nextLink ? graphPageUrl(nextLink, input.initialUrl) : undefined
  return { items: values, ...(nextCursor ? { nextCursor } : {}) }
}

async function fetchGraphDetail<T>(input: {
  args: ExecuteServerSelectorArgs
  serviceId: string
  url: string
  token?: string
}): Promise<T> {
  const token = input.token ?? (await graphToken(input.args, input.serviceId))
  return fetchProviderJson<T>(input.url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: input.args.signal,
    redirect: 'error',
  })
}

function requireGraphId(value: string | undefined, label: string): string {
  if (!value) throw new SelectorContextUnavailableError()
  const validation = validateMicrosoftGraphId(value, label)
  if (!validation.isValid) throw new SelectorContextUnavailableError()
  return validation.sanitized ?? value
}

function requireDriveId(value: string | undefined): string | undefined {
  if (!value) return undefined
  const validation = validatePathSegment(value, {
    paramName: 'driveId',
    customPattern: GRAPH_ID_PATTERN,
  })
  if (!validation.isValid) throw new SelectorContextUnavailableError()
  return validation.sanitized ?? value
}

function encodeGraphSearch(value: string): string {
  return encodeURIComponent(value).replace(/'/g, '%27')
}

async function listPlannerPlans(args: ExecuteServerSelectorArgs) {
  const page = await fetchGraphPage<{ id: string; title: string }>({
    args,
    serviceId: 'microsoft-planner',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/planner/plans',
  })
  return {
    items: page.items.map((plan) => ({ id: plan.id, label: plan.title })),
    nextCursor: page.nextCursor,
  }
}

async function listPlannerTasks(args: ExecuteServerSelectorArgs) {
  const planId = requireGraphId(args.context.planId, 'planId')
  const page = await fetchGraphPage<{ id: string; title: string }>({
    args,
    serviceId: 'microsoft-planner',
    initialUrl: `https://graph.microsoft.com/v1.0/planner/plans/${encodeURIComponent(planId)}/tasks`,
  })
  return {
    items: page.items.map((task) => ({ id: task.id, label: task.title })),
    nextCursor: page.nextCursor,
  }
}

async function listOutlookFolders(args: ExecuteServerSelectorArgs) {
  const page = await fetchGraphPage<{ id: string; displayName: string }>({
    args,
    serviceId: 'outlook',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/mailFolders?$top=999',
  })
  return {
    items: page.items.map((folder) => ({ id: folder.id, label: folder.displayName })),
    nextCursor: page.nextCursor,
  }
}

async function executeOutlookFolders(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    const folderId = requireGraphId(args.request.id, 'folderId')
    const folder = await fetchGraphDetail<{ id: string; displayName: string }>({
      args,
      serviceId: 'outlook',
      url: `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(folderId)}?$select=id,displayName`,
    })
    return detailSelectorResult({ id: folder.id, label: folder.displayName })
  }
  const page = await listOutlookFolders(args)
  return listSelectorResult(page.items, page.nextCursor)
}

async function listOutlookCalendars(args: ExecuteServerSelectorArgs) {
  const page = await fetchGraphPage<{ id: string; name: string }>({
    args,
    serviceId: 'outlook',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/calendars?$top=100',
  })
  return {
    items: page.items.map((calendar) => ({ id: calendar.id, label: calendar.name })),
    nextCursor: page.nextCursor,
  }
}

async function executeOutlookCalendars(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    const calendarId = requireGraphId(args.request.id, 'calendarId')
    const calendar = await fetchGraphDetail<{ id: string; name: string }>({
      args,
      serviceId: 'outlook',
      url: `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}?$select=id,name`,
    })
    return detailSelectorResult({ id: calendar.id, label: calendar.name })
  }
  const page = await listOutlookCalendars(args)
  return listSelectorResult(page.items, page.nextCursor)
}

async function listTeams(args: ExecuteServerSelectorArgs) {
  const page = await fetchGraphPage<{ id: string; displayName?: string }>({
    args,
    serviceId: 'microsoft-teams',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/joinedTeams',
  })
  return {
    items: page.items.map((team) => ({ id: team.id, label: team.displayName || team.id })),
    nextCursor: page.nextCursor,
  }
}

async function executeTeams(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    const teamId = requireGraphId(args.request.id, 'teamId')
    const team = await fetchGraphDetail<{ id: string; displayName?: string }>({
      args,
      serviceId: 'microsoft-teams',
      url: `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}?$select=id,displayName`,
    })
    return detailSelectorResult({ id: team.id, label: team.displayName || team.id })
  }
  const page = await listTeams(args)
  return listSelectorResult(page.items, page.nextCursor)
}

async function listChannels(args: ExecuteServerSelectorArgs) {
  const teamId = requireGraphId(args.context.teamId, 'teamId')
  const page = await fetchGraphPage<{ id: string; displayName?: string }>({
    args,
    serviceId: 'microsoft-teams',
    initialUrl: `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels`,
  })
  return {
    items: page.items.map((channel) => ({
      id: channel.id,
      label: channel.displayName || channel.id,
    })),
    nextCursor: page.nextCursor,
  }
}

async function executeChannels(args: ExecuteServerSelectorArgs) {
  const teamId = requireGraphId(args.context.teamId, 'teamId')
  if (args.request.kind === 'detail') {
    const channelId = requireGraphId(args.request.id, 'channelId')
    const channel = await fetchGraphDetail<{ id: string; displayName?: string }>({
      args,
      serviceId: 'microsoft-teams',
      url: `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}?$select=id,displayName`,
    })
    return detailSelectorResult({
      id: channel.id,
      label: channel.displayName || channel.id,
    })
  }
  const page = await listChannels(args)
  return listSelectorResult(page.items, page.nextCursor)
}

async function chatDisplayName(
  chat: { id: string; topic?: string },
  token: string,
  signal?: AbortSignal
): Promise<string> {
  if (chat.topic?.trim() && chat.topic !== 'null') return chat.topic
  const validation = validateMicrosoftGraphId(chat.id, 'chatId')
  if (!validation.isValid) return `Chat ${chat.id.slice(0, 8)}...`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  try {
    const members = await fetchProviderJson<{ value?: Array<{ displayName?: string }> }>(
      `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chat.id)}/members`,
      { headers, signal, redirect: 'error' }
    )
    const names = (members.value ?? [])
      .flatMap((member) =>
        member.displayName && member.displayName !== 'Unknown' ? [member.displayName] : []
      )
      .slice(0, 3)
    if (names.length === 1) return names[0]
    if (names.length === 2) return names.join(' & ')
    if (names.length > 2) return `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`
  } catch {
    signal?.throwIfAborted()
    // A label enrichment failure must not hide an otherwise selectable chat.
  }
  try {
    const messages = await fetchProviderJson<{
      value?: Array<{
        eventDetail?: { chatDisplayName?: string }
        from?: { user?: { displayName?: string } }
      }>
    }>(
      `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chat.id)}/messages?$top=10&$orderby=createdDateTime desc`,
      { headers, signal, redirect: 'error' }
    )
    for (const message of messages.value ?? []) {
      if (message.eventDetail?.chatDisplayName) return message.eventDetail.chatDisplayName
    }
    const names = [
      ...new Set(
        (messages.value ?? []).flatMap((message) => {
          const name = message.from?.user?.displayName
          return name && name !== 'Unknown' ? [name] : []
        })
      ),
    ].slice(0, 3)
    if (names.length === 1) return names[0]
    if (names.length === 2) return names.join(' & ')
    if (names.length > 2) return `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`
  } catch {
    signal?.throwIfAborted()
    // Fall through to the stable id-based label.
  }
  return `Chat ${chat.id.split(':')[0] || chat.id.slice(0, 8)}...`
}

async function listChats(args: ExecuteServerSelectorArgs) {
  const token = await graphToken(args, 'microsoft-teams')
  const page = await fetchGraphPage<{ id: string; topic?: string }>({
    args,
    serviceId: 'microsoft-teams',
    token,
    initialUrl: 'https://graph.microsoft.com/v1.0/me/chats?$top=50',
  })
  return {
    items: await mapWithConcurrency(page.items, CHAT_LABEL_CONCURRENCY, async (chat) => ({
      id: chat.id,
      label: await chatDisplayName(chat, token, args.signal),
    })),
    nextCursor: page.nextCursor,
  }
}

async function executeChats(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    const chatId = requireGraphId(args.request.id, 'chatId')
    const token = await graphToken(args, 'microsoft-teams')
    const chat = await fetchGraphDetail<{ id: string; topic?: string }>({
      args,
      serviceId: 'microsoft-teams',
      token,
      url: `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}`,
    })
    return detailSelectorResult({
      id: chat.id,
      label: await chatDisplayName(chat, token, args.signal),
    })
  }
  const page = await listChats(args)
  return listSelectorResult(page.items, page.nextCursor)
}

interface DriveItem {
  id: string
  name: string
  file?: { mimeType?: string }
  folder?: Record<string, unknown>
  mimeType?: string
}

async function listOneDriveFiles(args: ExecuteServerSelectorArgs) {
  const filesOnly = args.context.mimeType === 'file'
  const query = new URLSearchParams()
  query.set(
    '$select',
    'id,name,file,folder,webUrl,size,createdDateTime,lastModifiedDateTime,createdBy,thumbnails'
  )
  query.set('$top', '999')
  const page = await fetchGraphPage<DriveItem>({
    args,
    serviceId: 'onedrive',
    initialUrl: `https://graph.microsoft.com/v1.0/me/drive/root/children?${query}`,
    includeItem: (item) => (filesOnly ? Boolean(item.file && !item.folder) : true),
  })
  return {
    items: page.items.map((item) => ({ id: item.id, label: item.name })),
    nextCursor: page.nextCursor,
  }
}

async function listOneDriveFolders(args: ExecuteServerSelectorArgs) {
  const driveId = requireDriveId(args.context.driveId)
  const drivePath = driveId ? `drives/${encodeURIComponent(driveId)}` : 'me/drive'
  const page = await fetchGraphPage<DriveItem>({
    args,
    serviceId: 'onedrive',
    initialUrl: `https://graph.microsoft.com/v1.0/${drivePath}/root/children?$filter=folder ne null&$select=id,name,folder,webUrl,createdDateTime,lastModifiedDateTime&$top=999`,
    includeItem: (item) => Boolean(item.folder),
  })
  return {
    items: page.items.map((item) => ({ id: item.id, label: item.name })),
    nextCursor: page.nextCursor,
  }
}

async function getDriveItem(
  args: ExecuteServerSelectorArgs,
  serviceId: string
): Promise<SafeSelectorOption> {
  const itemId = requireGraphId(
    args.request.kind === 'detail' ? args.request.id : undefined,
    'itemId'
  )
  const driveId = requireDriveId(args.context.driveId)
  let basePath: string
  try {
    basePath = getItemBasePath(itemId, driveId)
  } catch {
    throw new SelectorContextUnavailableError()
  }
  const item = await fetchGraphDetail<{ id: string; name: string }>({
    args,
    serviceId,
    url: `${basePath}?$select=id,name,file,folder`,
  })
  return { id: item.id, label: item.name }
}

async function executeOneDriveFiles(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    return detailSelectorResult(await getDriveItem(args, 'onedrive'))
  }
  const page = await listOneDriveFiles(args)
  return listSelectorResult(page.items, page.nextCursor)
}

async function executeOneDriveFolders(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    return detailSelectorResult(await getDriveItem(args, 'onedrive'))
  }
  const page = await listOneDriveFolders(args)
  return listSelectorResult(page.items, page.nextCursor)
}

async function listWorksheets(
  args: ExecuteServerSelectorArgs
): Promise<GraphPage<SafeSelectorOption>> {
  const spreadsheetId = requireGraphId(args.context.spreadsheetId, 'spreadsheetId')
  const driveId = requireDriveId(args.context.driveId)
  let basePath: string
  try {
    basePath = getItemBasePath(spreadsheetId, driveId)
  } catch {
    throw new SelectorContextUnavailableError()
  }
  const page = await fetchGraphPage<{ id: string; name: string; position: number }>({
    args,
    serviceId: 'microsoft-excel',
    initialUrl: `${basePath}/workbook/worksheets?$select=id,name,position&$orderby=position`,
  })
  return {
    items: page.items
      .sort((left, right) => left.position - right.position)
      .map((sheet) => ({ id: sheet.name, label: sheet.name })),
    nextCursor: page.nextCursor,
  }
}

function requireSiteId(value: string | undefined): string {
  if (!value) throw new SelectorContextUnavailableError()
  const validation = validateSharePointSiteId(value, 'siteId')
  if (!validation.isValid) throw new SelectorContextUnavailableError()
  return validation.sanitized ?? value
}

async function executeDrives(args: ExecuteServerSelectorArgs) {
  const siteId = requireSiteId(args.context.siteId)
  const token = await graphToken(args, 'microsoft-excel')
  if (args.request.kind === 'detail') {
    const driveId = requireDriveId(args.request.id)
    if (!driveId) throw new SelectorContextUnavailableError()
    const drive = await fetchProviderJson<{ id: string; name: string }>(
      `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/drives/${encodeURIComponent(driveId)}?$select=id,name,driveType,webUrl`,
      { headers: { Authorization: `Bearer ${token}` }, signal: args.signal, redirect: 'error' }
    )
    return flatSelectorResult(args.request, [{ id: drive.id, label: drive.name }], true)
  }
  const page = await fetchGraphPage<{ id: string; name: string }>({
    args,
    serviceId: 'microsoft-excel',
    token,
    initialUrl: `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,driveType,webUrl&$top=999`,
  })
  return listSelectorResult(
    page.items.map((drive) => ({ id: drive.id, label: drive.name })),
    page.nextCursor
  )
}

const OFFICE_FILE_TYPES = {
  excel: {
    extension: '.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    serviceId: 'microsoft-excel',
  },
  word: {
    extension: '.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    serviceId: 'microsoft-word',
  },
} as const

async function listOfficeFiles(
  args: ExecuteServerSelectorArgs,
  fileType: keyof typeof OFFICE_FILE_TYPES
) {
  const config = OFFICE_FILE_TYPES[fileType]
  const driveId = requireDriveId(args.context.driveId)
  const drivePath = driveId ? `drives/${encodeURIComponent(driveId)}` : 'me/drive'
  const search = args.request.kind === 'list' ? (args.request.search ?? '') : ''
  const searchQuery = search ? `${search} ${config.extension}` : config.extension
  const params = new URLSearchParams()
  params.set(
    '$select',
    'id,name,mimeType,webUrl,thumbnails,createdDateTime,lastModifiedDateTime,size,createdBy'
  )
  params.set('$top', '999')
  const page = await fetchGraphPage<DriveItem>({
    args,
    serviceId: config.serviceId,
    initialUrl: `https://graph.microsoft.com/v1.0/${drivePath}/root/search(q='${encodeGraphSearch(searchQuery)}')?${params}`,
    includeItem: (file) =>
      file.name?.toLowerCase().endsWith(config.extension) || file.mimeType === config.mimeType,
  })
  return {
    items: page.items.map((file) => ({ id: file.id, label: file.name })),
    nextCursor: page.nextCursor,
  }
}

async function executeOfficeFiles(
  args: ExecuteServerSelectorArgs,
  fileType: keyof typeof OFFICE_FILE_TYPES
) {
  if (args.request.kind === 'detail') {
    return detailSelectorResult(await getDriveItem(args, OFFICE_FILE_TYPES[fileType].serviceId))
  }
  const page = await listOfficeFiles(args, fileType)
  return listSelectorResult(page.items, page.nextCursor)
}

async function executePlannerPlans(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    const planId = requireGraphId(args.request.id, 'planId')
    const token = await graphToken(args, 'microsoft-planner')
    const plan = await fetchProviderJson<{ id: string; title: string }>(
      `https://graph.microsoft.com/v1.0/planner/plans/${encodeURIComponent(planId)}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: args.signal,
        redirect: 'error',
      }
    )
    return detailSelectorResult({ id: plan.id, label: plan.title })
  }
  const page = await listPlannerPlans(args)
  return listSelectorResult(page.items, page.nextCursor)
}

async function executePlannerTasks(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    const planId = requireGraphId(args.context.planId, 'planId')
    const taskId = requireGraphId(args.request.id, 'taskId')
    const token = await graphToken(args, 'microsoft-planner')
    const task = await fetchProviderJson<{ id: string; title: string; planId: string }>(
      `https://graph.microsoft.com/v1.0/planner/tasks/${encodeURIComponent(taskId)}?$select=id,title,planId`,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: args.signal,
        redirect: 'error',
      }
    )
    if (task.planId !== planId) return detailSelectorResult(null)
    return detailSelectorResult({ id: task.id, label: task.title })
  }
  const page = await listPlannerTasks(args)
  return listSelectorResult(page.items, page.nextCursor)
}

const plannerCredential = microsoftCredential('microsoft-planner')
const outlookCredential = microsoftCredential('outlook')
const teamsCredential = microsoftCredential('microsoft-teams')
const oneDriveCredential = microsoftCredential('onedrive')
const oneDriveFolderCredential: SelectorCredentialPolicy = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['onedrive', 'microsoft-word'],
  resourceServiceId: 'onedrive',
}
const excelCredential = microsoftCredential('microsoft-excel')
const wordCredential = microsoftCredential('microsoft-word')

export const microsoftSelectorAttachments = {
  'microsoft.planner.plans': {
    credential: plannerCredential,
    destination: 'fixed',
    execute: executePlannerPlans,
  },
  'microsoft.planner': {
    credential: plannerCredential,
    destination: 'fixed',
    execute: executePlannerTasks,
  },
  'outlook.folders': {
    credential: outlookCredential,
    destination: 'fixed',
    execute: executeOutlookFolders,
  },
  'outlook.calendars': {
    credential: outlookCredential,
    destination: 'fixed',
    execute: executeOutlookCalendars,
  },
  'microsoft.teams': {
    credential: teamsCredential,
    destination: 'fixed',
    execute: executeTeams,
  },
  'microsoft.chats': {
    credential: teamsCredential,
    destination: 'fixed',
    execute: executeChats,
  },
  'microsoft.channels': {
    credential: teamsCredential,
    destination: 'fixed',
    execute: executeChannels,
  },
  'onedrive.files': {
    credential: oneDriveCredential,
    destination: 'fixed',
    execute: executeOneDriveFiles,
  },
  'onedrive.folders': {
    credential: oneDriveFolderCredential,
    destination: 'fixed',
    execute: executeOneDriveFolders,
  },
  'microsoft.excel.sheets': {
    credential: excelCredential,
    destination: 'fixed',
    execute: async (args) => {
      const page = await listWorksheets(args)
      return listSelectorResult(page.items, page.nextCursor)
    },
  },
  'microsoft.excel.drives': {
    credential: excelCredential,
    destination: 'fixed',
    execute: executeDrives,
  },
  'microsoft.excel': {
    credential: excelCredential,
    destination: 'fixed',
    execute: async (args) => executeOfficeFiles(args, 'excel'),
  },
  'microsoft.word': {
    credential: wordCredential,
    destination: 'fixed',
    execute: async (args) => executeOfficeFiles(args, 'word'),
  },
} satisfies ServerSelectorAttachmentMap<MicrosoftSelectorKey>
