import { normalizeEmail } from '@sim/utils/string'
import { z } from 'zod'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID } from '@/connectors/google-drive/meta'
import {
  GOOGLE_WORKSPACE_DRIVES_PAGE_SIZE,
  listGoogleWorkspaceDrives,
} from '@/connectors/google-drive/workspace-drives'
import {
  GOOGLE_WORKSPACE_USERS_PAGE_SIZE,
  getGoogleWorkspaceUser,
  listGoogleWorkspaceUsers,
  selectedGoogleWorkspaceUsers,
} from '@/connectors/google-workspace/users'
import type { ConnectorConfig, ExternalDocumentList } from '@/connectors/types'
import { parseOptionalUnlimitedSafeInteger } from '@/connectors/utils'

const CURSOR_PREFIX = 'gdrive-company:v1:'
const MAX_CURSOR_BYTES = 384 * 1024
const cursorSchema = z.object({
  users: z
    .array(
      z.object({
        id: z.string().min(1).max(256),
        email: z.string().email().max(254),
        customerId: z.string().min(1).max(256),
      })
    )
    .max(GOOGLE_WORKSPACE_USERS_PAGE_SIZE),
  nextUsersPageToken: z.string().min(1).max(8192).optional(),
  scope: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('user'),
      cursor: z
        .string()
        .min(1)
        .max(256 * 1024)
        .optional(),
    }),
    z.object({ kind: z.literal('drives'), pageToken: z.string().min(1).max(8192) }),
    z.object({
      kind: z.literal('drive'),
      driveIds: z.array(z.string().min(1).max(256)).min(1).max(GOOGLE_WORKSPACE_DRIVES_PAGE_SIZE),
      nextPageToken: z.string().min(1).max(8192).optional(),
      cursor: z
        .string()
        .min(1)
        .max(256 * 1024)
        .optional(),
    }),
  ]),
})
type CompanyCursor = z.infer<typeof cursorSchema>

type DelegatedTokenResolver = (subject: string) => Promise<string>

function delegatedTokenResolver(syncContext: Record<string, unknown>): DelegatedTokenResolver {
  if (typeof syncContext.getDelegatedAccessToken !== 'function') {
    throw new Error('Company-wide Google Drive indexing requires a delegated service account')
  }
  return syncContext.getDelegatedAccessToken as DelegatedTokenResolver
}

function cancellationSignal(syncContext?: Record<string, unknown>): AbortSignal | undefined {
  return syncContext?.signal instanceof AbortSignal ? syncContext.signal : undefined
}

export class InvalidGoogleCompanyCursor extends Error {}

function readCursor(cursor: string): CompanyCursor {
  try {
    if (!cursor.startsWith(CURSOR_PREFIX) || cursor.length > MAX_CURSOR_BYTES) throw new Error()
    return cursorSchema.parse(
      JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'))
    )
  } catch {
    throw new InvalidGoogleCompanyCursor(
      'Google Workspace crawl cursor is invalid; restart the sync'
    )
  }
}

function writeCursor(cursor: CompanyCursor): string {
  const serialized = `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor)).toString('base64url')}`
  if (serialized.length > MAX_CURSOR_BYTES) {
    throw new Error('Google Workspace crawl exceeded its continuation-size limit')
  }
  return serialized
}

/** Positive caps can stop before later users; central sources must finish their selected corpus. */
function validateCompanyConfig(sourceConfig: Record<string, unknown>): string[] {
  if (
    parseOptionalUnlimitedSafeInteger(
      sourceConfig.maxFiles,
      'Max Files must be a positive safe integer, or 0 for unlimited'
    ) > 0
  ) {
    throw new Error(
      'Max Files is not supported for company-wide indexing; narrow Users or Folders instead'
    )
  }
  return selectedGoogleWorkspaceUsers(sourceConfig.userEmails)
}

/** Verifies selected identities belong to the same Workspace customer before saving. */
export async function validateGoogleCompanyConfig(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  syncContext: Record<string, unknown>
): Promise<string> {
  delegatedTokenResolver(syncContext)
  const selected = validateCompanyConfig(sourceConfig)
  const adminEmail = sourceConfig[GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID]
  if (typeof adminEmail !== 'string' || !adminEmail.trim()) {
    throw new Error('Enter a Directory administrator email')
  }
  const administrator = await getGoogleWorkspaceUser(accessToken, normalizeEmail(adminEmail), {
    validate: true,
  })
  if (!administrator?.active)
    throw new Error('The Directory administrator must be an active Google Workspace user')
  await mapWithConcurrency(selected, 4, async (email) => {
    const user = await getGoogleWorkspaceUser(accessToken, email, { validate: true })
    if (!user || user.customerId !== administrator.customerId || user.email !== email) {
      throw new Error(`User "${email}" is not a primary email in this Google Workspace customer`)
    }
    if (!user.active)
      throw new Error(`User "${email}" must be an active, non-guest Google Workspace user`)
  })
  if (selected.length > 0) return selected[0]
  const sample = await listGoogleWorkspaceUsers(accessToken, undefined, undefined, {
    validate: true,
  })
  return sample.users.find((user) => user.active)?.email ?? administrator.email
}

/**
 * Visits one user's Drive page per call. A bounded Directory page and the nested
 * Drive cursor are durable; delegated tokens and per-page document identities are not.
 */
export async function listGoogleCompanyDocuments(input: {
  accessToken: string
  sourceConfig: Record<string, unknown>
  cursor?: string
  syncContext: Record<string, unknown>
  listUserDocuments: ConnectorConfig['listDocuments']
}): Promise<ExternalDocumentList> {
  const { accessToken, sourceConfig, syncContext, listUserDocuments } = input
  const resolveToken = delegatedTokenResolver(syncContext)
  syncContext.googleDrivePageAccess = undefined
  const selected = validateCompanyConfig(sourceConfig)
  const signal = cancellationSignal(syncContext)
  signal?.throwIfAborted()
  let state: CompanyCursor = input.cursor
    ? readCursor(input.cursor)
    : { users: [], scope: { kind: 'user' } }
  if (state.users.length === 0) {
    const page = await listGoogleWorkspaceUsers(accessToken, state.nextUsersPageToken, signal)
    state = {
      users: page.users
        .filter((user) => user.active && (!selected.length || selected.includes(user.email)))
        .map(({ id, email, customerId }) => ({ id, email, customerId })),
      nextUsersPageToken: page.nextPageToken,
      scope: { kind: 'user' },
    }
  }
  let currentCursor = writeCursor(state)
  const pending = state.users[0]
  if (!pending) {
    return {
      documents: [],
      currentCursor,
      hasMore: Boolean(state.nextUsersPageToken),
      nextCursor: state.nextUsersPageToken ? writeCursor(state) : undefined,
    }
  }

  const user = await getGoogleWorkspaceUser(accessToken, pending.id, { signal })
  if (user && (user.customerId !== pending.customerId || user.id !== pending.id)) {
    throw new Error('Google Workspace user no longer belongs to the expected customer')
  }
  const advanceUser = (): CompanyCursor => ({
    users: state.users.slice(1),
    nextUsersPageToken: state.nextUsersPageToken,
    scope: { kind: 'user' },
  })
  if (!user?.active || (selected.length > 0 && !selected.includes(user.email))) {
    state = advanceUser()
    const hasMore = state.users.length > 0 || Boolean(state.nextUsersPageToken)
    return {
      documents: [],
      currentCursor,
      hasMore,
      nextCursor: hasMore ? writeCursor(state) : undefined,
    }
  }

  signal?.throwIfAborted()
  const userToken = await resolveToken(user.email)
  const nextDrives = async (pageToken?: string): Promise<CompanyCursor> => {
    const drives = await listGoogleWorkspaceDrives(userToken, pageToken, signal)
    if (drives.driveIds.length > 0) {
      return {
        ...state,
        scope: { kind: 'drive', driveIds: drives.driveIds, nextPageToken: drives.nextPageToken },
      }
    }
    return drives.nextPageToken
      ? { ...state, scope: { kind: 'drives', pageToken: drives.nextPageToken } }
      : advanceUser()
  }
  if (state.scope.kind === 'drives') {
    state = await nextDrives(state.scope.pageToken)
    if (state.scope.kind !== 'drive') {
      const hasMore = state.users.length > 0 || Boolean(state.nextUsersPageToken)
      return {
        documents: [],
        currentCursor,
        hasMore,
        nextCursor: hasMore ? writeCursor(state) : undefined,
      }
    }
    currentCursor = writeCursor(state)
  }
  syncContext.googleDriveSharedDriveId =
    state.scope.kind === 'drive' ? state.scope.driveIds[0] : undefined
  const page = await listUserDocuments(userToken, sourceConfig, state.scope.cursor, syncContext)
  syncContext.googleDrivePageAccess = {
    token: userToken,
    externalIds: new Set(page.documents.map((document) => document.externalId)),
  }
  if (page.hasMore) {
    if (!page.nextCursor) throw new Error('Google Drive omitted its continuation token')
    state = { ...state, scope: { ...state.scope, cursor: page.nextCursor } }
  } else if (state.scope.kind === 'user') {
    state = await nextDrives()
  } else if (state.scope.driveIds.length > 1) {
    state = {
      ...state,
      scope: { ...state.scope, driveIds: state.scope.driveIds.slice(1), cursor: undefined },
    }
  } else {
    state = state.scope.nextPageToken ? await nextDrives(state.scope.nextPageToken) : advanceUser()
  }
  const hasMore = state.users.length > 0 || Boolean(state.nextUsersPageToken)
  return { ...page, currentCursor, hasMore, nextCursor: hasMore ? writeCursor(state) : undefined }
}

/** Hydration and permission reads use the same verified identity as their replayable listing page. */
export async function googleDriveDocumentToken(
  accessToken: string,
  externalId: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  if (syncContext?.mirrorsSourceAcls !== true) return accessToken
  const page = syncContext.googleDrivePageAccess
  if (
    !page ||
    typeof page !== 'object' ||
    !('externalIds' in page) ||
    !(page.externalIds instanceof Set) ||
    !page.externalIds.has(externalId) ||
    !('token' in page) ||
    typeof page.token !== 'string' ||
    !page.token
  ) {
    throw new Error('Google Drive document has no verified delegated listing identity')
  }
  cancellationSignal(syncContext)?.throwIfAborted()
  return page.token
}
