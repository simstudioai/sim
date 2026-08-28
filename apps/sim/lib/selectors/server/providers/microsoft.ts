import {
  validateMicrosoftGraphId,
  validatePathSegment,
  validateSharePointSiteId,
} from '@/lib/core/security/input-validation'
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

async function drainGraph<T>(input: {
  args: ExecuteServerSelectorArgs
  serviceId: string
  initialUrl: string
  maxPages: number
  token?: string
}): Promise<T[]> {
  const token = input.token ?? (await graphToken(input.args, input.serviceId))
  const values: T[] = []
  let nextUrl: string | undefined = input.initialUrl
  for (let page = 0; page < input.maxPages && nextUrl; page++) {
    const data = await fetchProviderJson<{ value?: T[] } & Record<string, unknown>>(nextUrl, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: input.args.signal,
      redirect: 'error',
    })
    if (Array.isArray(data.value)) values.push(...data.value)
    const nextLink = getGraphNextPageUrl(data)
    nextUrl = nextLink ? assertGraphNextPageUrl(nextLink) : undefined
  }
  return values
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

async function listPlannerPlans(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const plans = await drainGraph<{ id: string; title: string }>({
    args,
    serviceId: 'microsoft-planner',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/planner/plans',
    maxPages: 20,
  })
  return plans.map((plan) => ({ id: plan.id, label: plan.title }))
}

async function listPlannerTasks(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const planId = requireGraphId(args.context.planId, 'planId')
  const tasks = await drainGraph<{ id: string; title: string }>({
    args,
    serviceId: 'microsoft-planner',
    initialUrl: `https://graph.microsoft.com/v1.0/planner/plans/${encodeURIComponent(planId)}/tasks`,
    maxPages: 20,
  })
  return tasks.map((task) => ({ id: task.id, label: task.title }))
}

async function listOutlookFolders(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const folders = await drainGraph<{ id: string; displayName: string }>({
    args,
    serviceId: 'outlook',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/mailFolders?$top=999',
    maxPages: 20,
  })
  return folders.map((folder) => ({ id: folder.id, label: folder.displayName }))
}

async function listOutlookCalendars(
  args: ExecuteServerSelectorArgs
): Promise<SafeSelectorOption[]> {
  const calendars = await drainGraph<{ id: string; name: string }>({
    args,
    serviceId: 'outlook',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/calendars?$top=100',
    maxPages: 10,
  })
  return calendars.map((calendar) => ({ id: calendar.id, label: calendar.name }))
}

async function listTeams(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const teams = await drainGraph<{ id: string; displayName?: string }>({
    args,
    serviceId: 'microsoft-teams',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/joinedTeams',
    maxPages: 20,
  })
  return teams.map((team) => ({ id: team.id, label: team.displayName || team.id }))
}

async function listChannels(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const teamId = requireGraphId(args.context.teamId, 'teamId')
  const channels = await drainGraph<{ id: string; displayName?: string }>({
    args,
    serviceId: 'microsoft-teams',
    initialUrl: `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels`,
    maxPages: 20,
  })
  return channels.map((channel) => ({ id: channel.id, label: channel.displayName || channel.id }))
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

async function listChats(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const token = await graphToken(args, 'microsoft-teams')
  const chats = await drainGraph<{ id: string; topic?: string }>({
    args,
    serviceId: 'microsoft-teams',
    token,
    initialUrl: 'https://graph.microsoft.com/v1.0/me/chats?$top=50',
    maxPages: 20,
  })
  return Promise.all(
    chats.map(async (chat) => ({
      id: chat.id,
      label: await chatDisplayName(chat, token, args.signal),
    }))
  )
}

interface DriveItem {
  id: string
  name: string
  file?: { mimeType?: string }
  folder?: Record<string, unknown>
  mimeType?: string
}

async function listOneDriveFiles(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const query = new URLSearchParams()
  query.set(
    '$select',
    'id,name,file,folder,webUrl,size,createdDateTime,lastModifiedDateTime,createdBy,thumbnails'
  )
  query.set('$top', '999')
  const files = await drainGraph<DriveItem>({
    args,
    serviceId: 'onedrive',
    initialUrl: `https://graph.microsoft.com/v1.0/me/drive/root/children?${query}`,
    maxPages: 20,
  })
  return files
    .filter((item) => item.file && !item.folder)
    .map((item) => ({ id: item.id, label: item.name }))
}

async function listOneDriveFolders(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const driveId = requireDriveId(args.context.driveId)
  const drivePath = driveId ? `drives/${encodeURIComponent(driveId)}` : 'me/drive'
  const folders = await drainGraph<DriveItem>({
    args,
    serviceId: 'onedrive',
    initialUrl: `https://graph.microsoft.com/v1.0/${drivePath}/root/children?$filter=folder ne null&$select=id,name,folder,webUrl,createdDateTime,lastModifiedDateTime&$top=999`,
    maxPages: 20,
  })
  return folders.filter((item) => item.folder).map((item) => ({ id: item.id, label: item.name }))
}

async function listWorksheets(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const spreadsheetId = requireGraphId(args.context.spreadsheetId, 'spreadsheetId')
  const driveId = requireDriveId(args.context.driveId)
  let basePath: string
  try {
    basePath = getItemBasePath(spreadsheetId, driveId)
  } catch {
    throw new SelectorContextUnavailableError()
  }
  const token = await graphToken(args, 'microsoft-excel')
  const data = await fetchProviderJson<{
    value?: Array<{ id: string; name: string; position: number }>
  }>(`${basePath}/workbook/worksheets`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: args.signal,
    redirect: 'error',
  })
  return (data.value ?? [])
    .sort((left, right) => left.position - right.position)
    .map((sheet) => ({ id: sheet.name, label: sheet.name }))
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
  const drives = await drainGraph<{ id: string; name: string }>({
    args,
    serviceId: 'microsoft-excel',
    token,
    initialUrl: `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,driveType,webUrl&$top=999`,
    maxPages: 10,
  })
  return flatSelectorResult(
    args.request,
    drives.map((drive) => ({ id: drive.id, label: drive.name })),
    true
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
): Promise<SafeSelectorOption[]> {
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
  const files = await drainGraph<DriveItem>({
    args,
    serviceId: config.serviceId,
    initialUrl: `https://graph.microsoft.com/v1.0/${drivePath}/root/search(q='${encodeGraphSearch(searchQuery)}')?${params}`,
    maxPages: 20,
  })
  return files
    .filter(
      (file) =>
        file.name?.toLowerCase().endsWith(config.extension) || file.mimeType === config.mimeType
    )
    .map((file) => ({ id: file.id, label: file.name }))
}

const plannerCredential = microsoftCredential('microsoft-planner')
const outlookCredential = microsoftCredential('outlook')
const teamsCredential = microsoftCredential('microsoft-teams')
const oneDriveCredential = microsoftCredential('onedrive')
const oneDriveFolderCredential: SelectorCredentialPolicy = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['onedrive', 'microsoft-word'],
}
const excelCredential = microsoftCredential('microsoft-excel')
const wordCredential = microsoftCredential('microsoft-word')

export const microsoftSelectorAttachments = {
  'microsoft.planner.plans': {
    credential: plannerCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listPlannerPlans(args), true),
  },
  'microsoft.planner': {
    credential: plannerCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listPlannerTasks(args), true),
  },
  'outlook.folders': {
    credential: outlookCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listOutlookFolders(args)),
  },
  'outlook.calendars': {
    credential: outlookCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listOutlookCalendars(args)),
  },
  'microsoft.teams': {
    credential: teamsCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listTeams(args)),
  },
  'microsoft.chats': {
    credential: teamsCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listChats(args)),
  },
  'microsoft.channels': {
    credential: teamsCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listChannels(args)),
  },
  'onedrive.files': {
    credential: oneDriveCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listOneDriveFiles(args)),
  },
  'onedrive.folders': {
    credential: oneDriveFolderCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listOneDriveFolders(args)),
  },
  'microsoft.excel.sheets': {
    credential: excelCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listWorksheets(args)),
  },
  'microsoft.excel.drives': {
    credential: excelCredential,
    destination: 'fixed',
    execute: executeDrives,
  },
  'microsoft.excel': {
    credential: excelCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listOfficeFiles(args, 'excel')),
  },
  'microsoft.word': {
    credential: wordCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listOfficeFiles(args, 'word')),
  },
} satisfies ServerSelectorAttachmentMap<MicrosoftSelectorKey>
