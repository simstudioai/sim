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
  truncation?: { truncated: boolean }
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
  if (input.truncation) input.truncation.truncated = Boolean(nextUrl)
  return values
}

function graphCapDiagnostics(truncated: boolean, pages: number) {
  return truncated ? { truncated: { reason: 'provider-cap' as const, pages } } : undefined
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
  const truncation = { truncated: false }
  const plans = await drainGraph<{ id: string; title: string }>({
    args,
    serviceId: 'microsoft-planner',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/planner/plans',
    maxPages: 20,
    truncation,
  })
  return {
    items: plans.map((plan) => ({ id: plan.id, label: plan.title })),
    truncated: truncation.truncated,
  }
}

async function listPlannerTasks(args: ExecuteServerSelectorArgs) {
  const planId = requireGraphId(args.context.planId, 'planId')
  const truncation = { truncated: false }
  const tasks = await drainGraph<{ id: string; title: string }>({
    args,
    serviceId: 'microsoft-planner',
    initialUrl: `https://graph.microsoft.com/v1.0/planner/plans/${encodeURIComponent(planId)}/tasks`,
    maxPages: 20,
    truncation,
  })
  return {
    items: tasks.map((task) => ({ id: task.id, label: task.title })),
    truncated: truncation.truncated,
  }
}

async function listOutlookFolders(args: ExecuteServerSelectorArgs) {
  const truncation = { truncated: false }
  const folders = await drainGraph<{ id: string; displayName: string }>({
    args,
    serviceId: 'outlook',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/mailFolders?$top=999',
    maxPages: 20,
    truncation,
  })
  return {
    items: folders.map((folder) => ({ id: folder.id, label: folder.displayName })),
    truncated: truncation.truncated,
  }
}

async function listOutlookCalendars(args: ExecuteServerSelectorArgs) {
  const truncation = { truncated: false }
  const calendars = await drainGraph<{ id: string; name: string }>({
    args,
    serviceId: 'outlook',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/calendars?$top=100',
    maxPages: 10,
    truncation,
  })
  return {
    items: calendars.map((calendar) => ({ id: calendar.id, label: calendar.name })),
    truncated: truncation.truncated,
  }
}

async function listTeams(args: ExecuteServerSelectorArgs) {
  const truncation = { truncated: false }
  const teams = await drainGraph<{ id: string; displayName?: string }>({
    args,
    serviceId: 'microsoft-teams',
    initialUrl: 'https://graph.microsoft.com/v1.0/me/joinedTeams',
    maxPages: 20,
    truncation,
  })
  return {
    items: teams.map((team) => ({ id: team.id, label: team.displayName || team.id })),
    truncated: truncation.truncated,
  }
}

async function listChannels(args: ExecuteServerSelectorArgs) {
  const teamId = requireGraphId(args.context.teamId, 'teamId')
  const truncation = { truncated: false }
  const channels = await drainGraph<{ id: string; displayName?: string }>({
    args,
    serviceId: 'microsoft-teams',
    initialUrl: `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels`,
    maxPages: 20,
    truncation,
  })
  return {
    items: channels.map((channel) => ({
      id: channel.id,
      label: channel.displayName || channel.id,
    })),
    truncated: truncation.truncated,
  }
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
  const truncation = { truncated: false }
  const chats = await drainGraph<{ id: string; topic?: string }>({
    args,
    serviceId: 'microsoft-teams',
    token,
    initialUrl: 'https://graph.microsoft.com/v1.0/me/chats?$top=50',
    maxPages: 20,
    truncation,
  })
  return {
    items: await Promise.all(
      chats.map(async (chat) => ({
        id: chat.id,
        label: await chatDisplayName(chat, token, args.signal),
      }))
    ),
    truncated: truncation.truncated,
  }
}

interface DriveItem {
  id: string
  name: string
  file?: { mimeType?: string }
  folder?: Record<string, unknown>
  mimeType?: string
}

async function listOneDriveFiles(args: ExecuteServerSelectorArgs) {
  const query = new URLSearchParams()
  query.set(
    '$select',
    'id,name,file,folder,webUrl,size,createdDateTime,lastModifiedDateTime,createdBy,thumbnails'
  )
  query.set('$top', '999')
  const truncation = { truncated: false }
  const files = await drainGraph<DriveItem>({
    args,
    serviceId: 'onedrive',
    initialUrl: `https://graph.microsoft.com/v1.0/me/drive/root/children?${query}`,
    maxPages: 20,
    truncation,
  })
  return {
    items: files
      .filter((item) => item.file && !item.folder)
      .map((item) => ({ id: item.id, label: item.name })),
    truncated: truncation.truncated,
  }
}

async function listOneDriveFolders(args: ExecuteServerSelectorArgs) {
  const driveId = requireDriveId(args.context.driveId)
  const drivePath = driveId ? `drives/${encodeURIComponent(driveId)}` : 'me/drive'
  const truncation = { truncated: false }
  const folders = await drainGraph<DriveItem>({
    args,
    serviceId: 'onedrive',
    initialUrl: `https://graph.microsoft.com/v1.0/${drivePath}/root/children?$filter=folder ne null&$select=id,name,folder,webUrl,createdDateTime,lastModifiedDateTime&$top=999`,
    maxPages: 20,
    truncation,
  })
  return {
    items: folders.filter((item) => item.folder).map((item) => ({ id: item.id, label: item.name })),
    truncated: truncation.truncated,
  }
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
  const truncation = { truncated: false }
  const drives = await drainGraph<{ id: string; name: string }>({
    args,
    serviceId: 'microsoft-excel',
    token,
    initialUrl: `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,driveType,webUrl&$top=999`,
    maxPages: 10,
    truncation,
  })
  return flatSelectorResult(
    args.request,
    drives.map((drive) => ({ id: drive.id, label: drive.name })),
    true,
    graphCapDiagnostics(truncation.truncated, 10)
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
  const truncation = { truncated: false }
  const files = await drainGraph<DriveItem>({
    args,
    serviceId: config.serviceId,
    initialUrl: `https://graph.microsoft.com/v1.0/${drivePath}/root/search(q='${encodeGraphSearch(searchQuery)}')?${params}`,
    maxPages: 20,
    truncation,
  })
  return {
    items: files
      .filter(
        (file) =>
          file.name?.toLowerCase().endsWith(config.extension) || file.mimeType === config.mimeType
      )
      .map((file) => ({ id: file.id, label: file.name })),
    truncated: truncation.truncated,
  }
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
    execute: async (args) => {
      const { items, truncated } = await listPlannerPlans(args)
      return flatSelectorResult(args.request, items, true, graphCapDiagnostics(truncated, 20))
    },
  },
  'microsoft.planner': {
    credential: plannerCredential,
    destination: 'fixed',
    execute: async (args) => {
      const { items, truncated } = await listPlannerTasks(args)
      return flatSelectorResult(args.request, items, true, graphCapDiagnostics(truncated, 20))
    },
  },
  'outlook.folders': {
    credential: outlookCredential,
    destination: 'fixed',
    execute: async (args) => {
      const { items, truncated } = await listOutlookFolders(args)
      return flatSelectorResult(args.request, items, false, graphCapDiagnostics(truncated, 20))
    },
  },
  'outlook.calendars': {
    credential: outlookCredential,
    destination: 'fixed',
    execute: async (args) => {
      const { items, truncated } = await listOutlookCalendars(args)
      return flatSelectorResult(args.request, items, false, graphCapDiagnostics(truncated, 10))
    },
  },
  'microsoft.teams': {
    credential: teamsCredential,
    destination: 'fixed',
    execute: async (args) => {
      const { items, truncated } = await listTeams(args)
      return flatSelectorResult(args.request, items, false, graphCapDiagnostics(truncated, 20))
    },
  },
  'microsoft.chats': {
    credential: teamsCredential,
    destination: 'fixed',
    execute: async (args) => {
      const { items, truncated } = await listChats(args)
      return flatSelectorResult(args.request, items, false, graphCapDiagnostics(truncated, 20))
    },
  },
  'microsoft.channels': {
    credential: teamsCredential,
    destination: 'fixed',
    execute: async (args) => {
      const { items, truncated } = await listChannels(args)
      return flatSelectorResult(args.request, items, false, graphCapDiagnostics(truncated, 20))
    },
  },
  'onedrive.files': {
    credential: oneDriveCredential,
    destination: 'fixed',
    execute: async (args) => {
      const { items, truncated } = await listOneDriveFiles(args)
      return flatSelectorResult(args.request, items, false, graphCapDiagnostics(truncated, 20))
    },
  },
  'onedrive.folders': {
    credential: oneDriveFolderCredential,
    destination: 'fixed',
    execute: async (args) => {
      const { items, truncated } = await listOneDriveFolders(args)
      return flatSelectorResult(args.request, items, false, graphCapDiagnostics(truncated, 20))
    },
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
    execute: async (args) => {
      const { items, truncated } = await listOfficeFiles(args, 'excel')
      return flatSelectorResult(args.request, items, false, graphCapDiagnostics(truncated, 20))
    },
  },
  'microsoft.word': {
    credential: wordCredential,
    destination: 'fixed',
    execute: async (args) => {
      const { items, truncated } = await listOfficeFiles(args, 'word')
      return flatSelectorResult(args.request, items, false, graphCapDiagnostics(truncated, 20))
    },
  },
} satisfies ServerSelectorAttachmentMap<MicrosoftSelectorKey>
