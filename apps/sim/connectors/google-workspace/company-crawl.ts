import { createLogger } from '@sim/logger'
import { normalizeEmail } from '@sim/utils/string'
import { z } from 'zod'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { GoogleApiError } from '@/connectors/google-workspace/api-errors'
import {
  type GoogleCompanyCursorAdapter,
  googleCompanyUserContextSchema,
} from '@/connectors/google-workspace/company-work'
import {
  GOOGLE_WORKSPACE_USERS_PAGE_SIZE,
  type GoogleWorkspaceUser,
  getGoogleWorkspaceUser,
  listGoogleWorkspaceUsers,
  selectedGoogleWorkspaceUsers,
} from '@/connectors/google-workspace/users'
import { listingFailuresSchema, MAX_LISTING_FAILURE_SAMPLES } from '@/connectors/listing-failures'
import { ConnectorSourceError } from '@/connectors/source-error'
import type {
  ConnectorConfig,
  ExternalDocument,
  ExternalDocumentList,
  ExternalListingFailures,
} from '@/connectors/types'
import { PER_MEMBER_LISTING_CONTEXT, sourceDocumentId } from '@/connectors/utils'

type GoogleWorkspaceProvider = 'gmail' | 'google_calendar'
const logger = createLogger('GoogleWorkspaceCrawl')
const CURSOR_PREFIX = 'google-workspace:v1:'
const MAX_CURSOR_BYTES = 384 * 1024
const MAX_PROVIDER_CURSOR_BYTES = 256 * 1024
const MAX_PAGE_DOCUMENTS = 2500
const cursorSchema = z.object({
  provider: z.enum(['gmail', 'google_calendar']),
  users: z.array(googleCompanyUserContextSchema).max(GOOGLE_WORKSPACE_USERS_PAGE_SIZE),
  nextUsersPageToken: z.string().min(1).max(8192).optional(),
  providerCursor: z.string().min(1).max(MAX_PROVIDER_CURSOR_BYTES).optional(),
  listingFailures: listingFailuresSchema.optional(),
})
type CompanyCursor = z.infer<typeof cursorSchema>

interface GoogleWorkspaceCrawlInput {
  provider: GoogleWorkspaceProvider
  accessToken: string
  sourceConfig: Record<string, unknown>
  syncContext: Record<string, unknown>
}

interface DelegatedUser {
  user: GoogleWorkspaceUser
  accessToken: string
  syncContext: Record<string, unknown>
}

interface PageAccess extends DelegatedUser {
  provider: GoogleWorkspaceProvider
  externalIds: Set<string>
}

/** Only the active page carries hydration authority; entries disappear with their sync context. */
const pageAccess = new WeakMap<Record<string, unknown>, PageAccess>()

export class InvalidGoogleWorkspaceCursor extends Error {}

function readCursor(cursor: string, provider: GoogleWorkspaceProvider): CompanyCursor {
  try {
    if (!cursor.startsWith(CURSOR_PREFIX) || cursor.length > MAX_CURSOR_BYTES) throw new Error()
    const state = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'))
    )
    if (state.provider !== provider || (!state.users.length && state.providerCursor))
      throw new Error()
    return state
  } catch {
    throw new InvalidGoogleWorkspaceCursor(
      'Google Workspace crawl cursor is invalid; restart the sync'
    )
  }
}

function writeCursor(state: CompanyCursor): string {
  cursorSchema.parse(state)
  const cursor = `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(state)).toString('base64url')}`
  if (cursor.length > MAX_CURSOR_BYTES) {
    throw new Error('Google Workspace crawl exceeded its continuation-size limit')
  }
  return cursor
}

/** Reuses the verified per-user crawl without placing every user's continuation in one cursor. */
export function googleWorkspaceCompanyCursorAdapter(
  provider: GoogleWorkspaceProvider
): GoogleCompanyCursorAdapter {
  return {
    seed: (user) => writeCursor({ provider, users: [user] }),
    resume: (cursor) => {
      const state = readCursor(cursor, provider)
      return state.users.map((user, index) => ({
        user,
        cursor: writeCursor({
          provider,
          users: [user],
          ...(index === 0 ? { providerCursor: state.providerCursor } : {}),
        }),
      }))
    },
  }
}

function signalFrom(context: Record<string, unknown>): AbortSignal | undefined {
  return context.signal instanceof AbortSignal ? context.signal : undefined
}

function tokenResolver(
  context: Record<string, unknown>
): (subject: string, signal?: AbortSignal) => Promise<string> {
  if (context.mirrorsSourceAcls !== true || typeof context.getDelegatedAccessToken !== 'function') {
    throw new Error('Company-wide indexing requires a delegated Google Workspace service account')
  }
  return context.getDelegatedAccessToken as (
    subject: string,
    signal?: AbortSignal
  ) => Promise<string>
}

function userContext(
  user: GoogleWorkspaceUser,
  context: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...PER_MEMBER_LISTING_CONTEXT,
    memberId: `google-workspace:${user.customerId}:${user.id}`,
    signal: signalFrom(context),
  }
}

async function delegate(
  user: GoogleWorkspaceUser,
  context: Record<string, unknown>
): Promise<string> {
  const signal = signalFrom(context)
  signal?.throwIfAborted()
  const resolveToken = tokenResolver(context)
  const token = await (signal ? resolveToken(user.email, signal) : resolveToken(user.email))
  signal?.throwIfAborted()
  if (typeof token !== 'string' || !token)
    throw new Error('Google Workspace delegation returned no access token')
  return token
}

function assertIdentity(user: GoogleWorkspaceUser, expected: CompanyCursor['users'][number]): void {
  if (user.id !== expected.id || user.customerId !== expected.customerId) {
    throw new Error('Google Workspace user no longer belongs to the expected customer')
  }
}

function ownerDocument(document: ExternalDocument, access: DelegatedUser): ExternalDocument {
  if (!sourceDocumentId(document.externalId, access.syncContext)) {
    throw new Error('Google Workspace document does not belong to its verified listing user')
  }
  return { ...document, acl: [`u:${access.user.email}`] }
}

/** A Directory user without a Gmail mailbox; the user scheduler decides whether to skip them. */
export class GoogleWorkspaceMailboxNotSetup extends Error {
  constructor() {
    super('Google Workspace user has no Gmail mailbox')
    this.name = 'GoogleWorkspaceMailboxNotSetup'
  }
}

/**
 * Evidence that a user lacks the service itself: no Gmail mailbox, or a Calendar list 403 whose
 * only reason is `notACalendarUser`. Admin changes to a user's services can take up to a day to
 * settle, so the user scheduler, which can see indexed documents, decides when this is a skip.
 */
export function serviceNotEnabledFailure(
  error: unknown
): Omit<ExternalListingFailures['samples'][number], 'scope'> | null {
  if (error instanceof GoogleWorkspaceMailboxNotSetup)
    return { operation: 'directory.users.get', reasons: ['mailboxNotSetup'] }
  return error instanceof GoogleApiError &&
    error.reasonsComplete &&
    error.status === 403 &&
    error.diagnostic?.operation === 'calendar.events.list' &&
    error.diagnostic.reasons.length === 1 &&
    error.diagnostic.reasons[0] === 'notACalendarUser'
    ? { operation: 'calendar.events.list', status: 403, reasons: ['notACalendarUser'] }
    : null
}

/** Isolates narrow user-list failures; a missing Calendar service propagates to the scheduler. */
function userListingFailure(
  error: unknown,
  provider: GoogleWorkspaceProvider
): Omit<ExternalListingFailures['samples'][number], 'scope'> | null {
  if (!(error instanceof GoogleApiError) || !error.diagnostic || !error.reasonsComplete) return null
  const reasons = error.diagnostic.reasons
  const isolated =
    !serviceNotEnabledFailure(error) &&
    (provider === 'gmail'
      ? error.diagnostic.operation === 'gmail.threads.list' &&
        error.status === 400 &&
        reasons.length > 0 &&
        reasons.every((reason) => reason === 'failedPrecondition')
      : error.diagnostic.operation === 'calendar.events.list' &&
        error.status === 403 &&
        reasons.length > 0 &&
        reasons.every((reason) => reason === 'forbidden' || reason === 'notACalendarUser'))
  return isolated
    ? { operation: error.diagnostic.operation, status: error.status, reasons: [...reasons] }
    : null
}

/** Validates directory access and returns one revalidated identity for a provider-specific probe. */
export async function validateGoogleWorkspaceConfig(
  input: GoogleWorkspaceCrawlInput
): Promise<DelegatedUser> {
  const { accessToken, sourceConfig, syncContext } = input
  tokenResolver(syncContext)
  const selected = selectedGoogleWorkspaceUsers(sourceConfig.userEmails)
  const adminEmail = sourceConfig.adminEmail
  if (typeof adminEmail !== 'string' || !adminEmail.trim())
    throw new Error('Enter a Directory administrator email')
  const signal = signalFrom(syncContext)
  const administrator = await getGoogleWorkspaceUser(accessToken, normalizeEmail(adminEmail), {
    validate: true,
    signal,
  })
  if (!administrator?.active)
    throw new Error('The Directory administrator must be an active Google Workspace user')
  const selectedUsers = await mapWithConcurrency(selected, 4, async (email) => {
    const user = await getGoogleWorkspaceUser(accessToken, email, { validate: true, signal })
    if (!user || user.customerId !== administrator.customerId || user.email !== email) {
      throw new Error(`User "${email}" is not a primary email in this Google Workspace customer`)
    }
    if (!user.active)
      throw new Error(`User "${email}" must be an active, non-guest Google Workspace user`)
    return user
  })
  const sample =
    selectedUsers[0] ??
    (await listGoogleWorkspaceUsers(accessToken, undefined, signal, { validate: true })).users.find(
      (user) => user.active
    ) ??
    administrator
  const user = await getGoogleWorkspaceUser(accessToken, sample.id, { validate: true, signal })
  if (!user?.active) throw new Error('The selected Google Workspace user is no longer active')
  assertIdentity(user, sample)
  if (
    user.customerId !== administrator.customerId ||
    (selected.length && !selected.includes(user.email))
  ) {
    throw new Error('The selected user is outside this Google Workspace configuration')
  }
  return {
    user,
    accessToken: await delegate(user, syncContext),
    syncContext: userContext(user, syncContext),
  }
}

/** Visits one user's provider page per call, with a bounded, replayable directory checkpoint. */
export async function listGoogleWorkspaceDocuments(
  input: GoogleWorkspaceCrawlInput & {
    cursor?: string
    listUserDocuments: ConnectorConfig['listDocuments']
  }
): Promise<ExternalDocumentList> {
  const { provider, accessToken, sourceConfig, syncContext, listUserDocuments } = input
  const previousAccess = pageAccess.get(syncContext)
  pageAccess.delete(syncContext)
  tokenResolver(syncContext)
  const selected = selectedGoogleWorkspaceUsers(sourceConfig.userEmails)
  const signal = signalFrom(syncContext)
  signal?.throwIfAborted()
  let state: CompanyCursor = input.cursor
    ? readCursor(input.cursor, provider)
    : { provider, users: [] }
  if (!state.users.length) {
    const page = await listGoogleWorkspaceUsers(
      accessToken,
      state.nextUsersPageToken,
      signal
    ).catch((error: unknown) => {
      /** Directory continuation tokens expire; retry a rejected fixed-query continuation from the start. */
      if (
        state.nextUsersPageToken &&
        error instanceof ConnectorSourceError &&
        error.status === 400
      ) {
        throw new InvalidGoogleWorkspaceCursor(
          'Google Workspace rejected its user continuation token; restart the sync'
        )
      }
      throw error
    })
    state = {
      provider,
      users: page.users
        .filter((user) => user.active && (!selected.length || selected.includes(user.email)))
        .map(({ id, email, customerId }) => ({ id, email, customerId })),
      nextUsersPageToken: page.nextPageToken,
      listingFailures: state.listingFailures,
    }
  }
  const currentCursor = writeCursor(state)
  const pending = state.users[0]
  const advance = (): CompanyCursor => ({
    provider,
    users: state.users.slice(1),
    nextUsersPageToken: state.nextUsersPageToken,
    listingFailures: state.listingFailures,
  })
  const emptyPage = (next: CompanyCursor): ExternalDocumentList => {
    const hasMore = Boolean(next.users.length || next.nextUsersPageToken)
    return {
      documents: [],
      currentCursor,
      hasMore,
      nextCursor: hasMore ? writeCursor(next) : undefined,
      ...(next.listingFailures && {
        listingFailures: next.listingFailures,
        reconciliationSafe: false,
      }),
    }
  }
  if (!pending) return emptyPage(state)
  const user = await getGoogleWorkspaceUser(accessToken, pending.id, { signal })
  if (user) assertIdentity(user, pending)
  if (!user?.active || (selected.length && !selected.includes(user.email)))
    return emptyPage(advance())
  const failedUser = (
    failure: Omit<ExternalListingFailures['samples'][number], 'scope'>
  ): ExternalDocumentList => {
    const sample = { scope: user.email, ...failure }
    const previous = state.listingFailures
    state.listingFailures = {
      count: (previous?.count ?? 0) + 1,
      samples: [...(previous?.samples ?? []), sample].slice(0, MAX_LISTING_FAILURE_SAMPLES),
    }
    syncContext.reconciliationUnsafe = true
    logger.warn('Google Workspace user could not be listed; continuing other users', {
      provider,
      ...sample,
    })
    return emptyPage(advance())
  }
  if (provider === 'gmail' && user.isMailboxSetup === false)
    throw new GoogleWorkspaceMailboxNotSetup()
  const access: PageAccess = {
    provider,
    user,
    accessToken: await delegate(user, syncContext),
    syncContext:
      previousAccess?.provider === provider &&
      previousAccess.user.id === user.id &&
      previousAccess.user.customerId === user.customerId &&
      previousAccess.user.email === user.email
        ? previousAccess.syncContext
        : userContext(user, syncContext),
    externalIds: new Set(),
  }
  access.syncContext.signal = signal
  let page: ExternalDocumentList
  try {
    page = await listUserDocuments(
      access.accessToken,
      sourceConfig,
      state.providerCursor,
      access.syncContext
    )
  } catch (error) {
    signal?.throwIfAborted()
    const failure = userListingFailure(error, provider)
    if (!failure) throw error
    return failedUser(failure)
  }
  signal?.throwIfAborted()
  if (access.syncContext.listingCapped === true) syncContext.listingCapped = true
  if (page.documents.length > MAX_PAGE_DOCUMENTS)
    throw new Error('Google Workspace provider returned an oversized document page')
  const documents = page.documents.map((document) => ownerDocument(document, access))
  const replay = { ...state, providerCursor: page.currentCursor ?? state.providerCursor }
  if (page.hasMore && (!page.nextCursor || page.nextCursor === replay.providerCursor)) {
    throw new Error('Google Workspace provider omitted or repeated its continuation token')
  }
  const next = page.hasMore ? { ...state, providerCursor: page.nextCursor } : advance()
  const hasMore = Boolean(next.users.length || next.nextUsersPageToken)
  const result = {
    ...page,
    documents,
    currentCursor: writeCursor(replay),
    hasMore,
    nextCursor: hasMore ? writeCursor(next) : undefined,
    ...(state.listingFailures && {
      listingFailures: state.listingFailures,
      reconciliationSafe: false,
    }),
  }
  access.externalIds = new Set(documents.map((document) => document.externalId))
  pageAccess.set(syncContext, access)
  return result
}

/** Refuses cross-user or out-of-page hydration; no administrator-token fallback is possible. */
export async function getGoogleWorkspaceDocument(input: {
  provider: GoogleWorkspaceProvider
  sourceConfig: Record<string, unknown>
  externalId: string
  syncContext: Record<string, unknown>
  getUserDocument: ConnectorConfig['getDocument']
}): Promise<ExternalDocument | null> {
  const { provider, sourceConfig, externalId, syncContext, getUserDocument } = input
  const access = pageAccess.get(syncContext)
  if (!access || access.provider !== provider || !access.externalIds.has(externalId)) {
    throw new Error('Google Workspace document has no verified delegated listing identity')
  }
  signalFrom(syncContext)?.throwIfAborted()
  const document = await getUserDocument(
    access.accessToken,
    sourceConfig,
    externalId,
    access.syncContext
  )
  signalFrom(syncContext)?.throwIfAborted()
  if (!document) return null
  if (document.externalId !== externalId)
    throw new Error('Google Workspace returned a different document during hydration')
  return ownerDocument(document, access)
}
