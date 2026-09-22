import { z } from 'zod'
import type {
  ConnectorPartitionWorkChanges,
  ConnectorPartitionWorkStore,
} from '@/lib/knowledge/connectors/partition-work'
import { googleDriveCompanyCursorAdapter } from '@/connectors/google-drive/company-crawl'
import { GoogleDriveApiError } from '@/connectors/google-drive/google-drive-errors'
import { GoogleApiError } from '@/connectors/google-workspace/api-errors'
import {
  googleWorkspaceCompanyCursorAdapter,
  isGoogleWorkspaceServiceNotEnabled,
} from '@/connectors/google-workspace/company-crawl'
import type {
  GoogleCompanyCursorAdapter,
  GoogleCompanyUserWork,
} from '@/connectors/google-workspace/company-work'
import {
  listGoogleWorkspaceUsers,
  selectedGoogleWorkspaceUsers,
} from '@/connectors/google-workspace/users'
import { MAX_LISTING_FAILURE_SAMPLES } from '@/connectors/listing-failures'
import { ConnectorSourceError } from '@/connectors/source-error'
import type {
  ConnectorConfig,
  ExternalDocumentList,
  ExternalListingFailures,
} from '@/connectors/types'

const CURSOR_PREFIX = 'google-company-work:v2:'
export const GOOGLE_COMPANY_PERMISSION_REFRESH_MS = 12 * 60 * 60 * 1000
const DIRECTORY_REFRESH_MS = 60 * 60 * 1000
const MAX_UNRESOLVED_FAILURES_PER_PASS = 3
const cursorSchema = z.object({
  directoryComplete: z.boolean(),
  directoryCursor: z.string().max(8192).optional(),
  directoryRefreshAt: z.string().datetime().optional(),
  phase: z.enum(['directory', 'users']),
  revision: z.number().int().nonnegative(),
  permissionTurn: z.boolean(),
  active: z
    .object({ userId: z.string().min(1).max(256), kind: z.enum(['content', 'permissions']) })
    .optional(),
})
type CompanyWorkCursor = z.infer<typeof cursorSchema>
type ListingFailure = ExternalListingFailures['samples'][number]

function adapterFor(provider: string): GoogleCompanyCursorAdapter | null {
  if (provider === 'google_drive') return googleDriveCompanyCursorAdapter
  if (provider === 'gmail' || provider === 'google_calendar')
    return googleWorkspaceCompanyCursorAdapter(provider)
  return null
}

export function isGoogleCompanySource(provider: string, context: Record<string, unknown>): boolean {
  return (
    adapterFor(provider) !== null &&
    context.mirrorsSourceAcls === true &&
    typeof context.getDelegatedAccessToken === 'function'
  )
}

function writeCursor(state: CompanyWorkCursor): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(state)).toString('base64url')}`
}

function readCursor(cursor: string): CompanyWorkCursor {
  if (cursor.length > 16 * 1024) throw new Error('Google company work cursor is too large')
  return cursorSchema.parse(
    JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'))
  )
}

/** An unresolved per-user 403 remains retryable partial coverage, never proof that access was revoked. */
function deferredUserFailure(
  error: unknown,
  user: GoogleCompanyUserWork['user']
): ListingFailure | null {
  if (
    (!(error instanceof GoogleApiError) && !(error instanceof GoogleDriveApiError)) ||
    error.status !== 403 ||
    !error.diagnostic
  )
    return null
  const { operation, reasons } = error.diagnostic
  const userListing =
    operation === 'calendar.events.list' ||
    operation === 'gmail.threads.list' ||
    operation === 'drive.files.list' ||
    operation === 'drive.drives.list'
  const globalReasons = new Set([
    'accessNotConfigured',
    'authError',
    'insufficientPermissions',
    'domainPolicy',
    'serviceDisabled',
    'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
    'API_KEY_SERVICE_BLOCKED',
    'SERVICE_DISABLED',
    'USER_PROJECT_DENIED',
    'dailyLimitExceeded',
    'quotaExceeded',
  ])
  if (!userListing || error.rateLimited || reasons.some((reason) => globalReasons.has(reason)))
    return null
  return {
    scope: user.email,
    operation,
    status: error.status,
    reasons: [...reasons],
    ...(error.diagnostic.reasonState ? { reasonState: error.diagnostic.reasonState } : {}),
  }
}

/** Durable fair scheduling adds no parallel provider or database work. */
export function createGoogleCompanyScheduler(input: {
  provider: string
  store: ConnectorPartitionWorkStore<GoogleCompanyUserWork['user']>
  listDocuments: ConnectorConfig['listDocuments']
  isListingCursorInvalidError?: ConnectorConfig['isListingCursorInvalidError']
  syncIntervalMinutes: number
  now?: () => Date
}) {
  const adapter = adapterFor(input.provider)
  if (!adapter) throw new Error('Unsupported Google company provider')
  const now = input.now ?? (() => new Date())
  const changes = new Map<string, ConnectorPartitionWorkChanges>()
  let unresolvedFailures = 0
  let permissionStartedAt: Date | undefined
  const initial = (): CompanyWorkCursor => ({
    directoryComplete: false,
    phase: 'directory',
    revision: 0,
    permissionTurn: false,
  })
  const nextCursor = (state: CompanyWorkCursor, change: ConnectorPartitionWorkChanges): string => {
    const cursor = writeCursor({ ...state, active: undefined, revision: state.revision + 1 })
    changes.set(cursor, change)
    return cursor
  }
  const listDocuments: ConnectorConfig['listDocuments'] = async (
    accessToken,
    sourceConfig,
    cursor,
    syncContext
  ) => {
    permissionStartedAt = undefined
    const signal = syncContext?.signal instanceof AbortSignal ? syncContext.signal : undefined
    signal?.throwIfAborted()
    if (cursor && !cursor.startsWith(CURSOR_PREFIX)) {
      return {
        documents: [],
        hasMore: true,
        nextCursor: nextCursor(initial(), {
          enqueue: adapter
            .resume(cursor)
            .map(({ user, cursor }) => ({ partitionKey: user.id, context: user, cursor })),
        }),
      }
    }
    let state = cursor ? readCursor(cursor) : initial()
    if (
      !state.active &&
      input.syncIntervalMinutes > 0 &&
      state.directoryComplete &&
      state.directoryRefreshAt &&
      new Date(state.directoryRefreshAt) <= now()
    ) {
      state = { ...state, directoryComplete: false, directoryCursor: undefined, phase: 'directory' }
    }
    const selected = selectedGoogleWorkspaceUsers(sourceConfig.userEmails)
    if (!state.active && !state.directoryComplete && state.phase === 'directory') {
      let page: Awaited<ReturnType<typeof listGoogleWorkspaceUsers>>
      try {
        page = await listGoogleWorkspaceUsers(accessToken, state.directoryCursor, signal)
      } catch (error) {
        if (
          !state.directoryCursor ||
          !(error instanceof ConnectorSourceError) ||
          error.status !== 400
        )
          throw error
        /** Re-enumeration is idempotent and preserves every already committed user continuation. */
        return {
          documents: [],
          hasMore: true,
          nextCursor: nextCursor({ ...state, directoryCursor: undefined }, {}),
        }
      }
      /** A user without a mailbox is out of scope like an inactive one until a later refresh sees it. */
      const users = page.users.filter(
        (user) =>
          user.active &&
          (input.provider !== 'gmail' || user.isMailboxSetup !== false) &&
          (!selected.length || selected.includes(user.email))
      )
      return {
        documents: [],
        currentCursor: writeCursor(state),
        hasMore: true,
        nextCursor: nextCursor(
          {
            ...state,
            phase: 'users',
            directoryCursor: page.nextPageToken,
            directoryComplete: !page.nextPageToken,
            directoryRefreshAt: page.nextPageToken
              ? undefined
              : new Date(now().getTime() + DIRECTORY_REFRESH_MS).toISOString(),
          },
          {
            enqueue: users.map(({ id, email, customerId }) => {
              const user = { id, email, customerId }
              return { partitionKey: user.id, context: user, cursor: adapter.seed(user) }
            }),
          }
        ),
      }
    }
    const preferred = state.permissionTurn ? 'permissions' : 'content'
    const work = state.active
      ? await input.store.get(state.active.userId, state.active.kind)
      : ((await input.store.next(preferred, now())) ??
        (await input.store.next(preferred === 'content' ? 'permissions' : 'content', now())))
    if (!work) {
      if (state.active) throw new Error('Google company crawl lost its durable user checkpoint')
      if (!state.directoryComplete)
        return {
          documents: [],
          hasMore: true,
          nextCursor: nextCursor({ ...state, phase: 'directory' }, {}),
        }
      const remaining = await input.store.remaining()
      return {
        documents: [],
        hasMore: remaining.count > 0,
        ...(remaining.count > 0
          ? {
              nextCursor: nextCursor(state, {}),
              resumeAt: new Date(
                Math.min(
                  remaining.retryAt?.getTime() ?? now().getTime() + 60_000,
                  input.syncIntervalMinutes > 0 && state.directoryRefreshAt
                    ? new Date(state.directoryRefreshAt).getTime()
                    : Number.POSITIVE_INFINITY
                )
              ).toISOString(),
            }
          : {}),
        listingFailures: remaining.failures ?? null,
        ...(remaining.failures ? { reconciliationSafe: false } : {}),
      }
    }
    const active = {
      ...state,
      revision: state.revision + 1,
      active: { userId: work.partitionKey, kind: work.kind },
    }
    const currentCursor = writeCursor(active)
    const next = {
      ...state,
      revision: active.revision,
      phase: state.directoryComplete ? 'users' : 'directory',
      permissionTurn: work.kind === 'content',
    } as CompanyWorkCursor
    const failed = async (
      failure: ListingFailure,
      unresolved = false,
      resetCursor = false
    ): Promise<ExternalDocumentList> => {
      const previous = await input.store.remaining()
      const retryAt = new Date(
        now().getTime() +
          (!unresolved ? 60 : Math.min(60, 5 * 2 ** Math.min(work.attempts, 4))) * 60_000
      )
      if (unresolved) unresolvedFailures += 1
      const failureSamples = [
        failure,
        ...(previous.failures?.samples ?? []).filter((item) => item.scope !== failure.scope),
      ]
      return {
        documents: [],
        currentCursor,
        hasMore: true,
        nextCursor: nextCursor(next, {
          update: {
            partitionKey: work.partitionKey,
            kind: work.kind,
            cursor: resetCursor ? adapter.seed(work.context) : (work.cursor ?? null),
            completed: false,
            retryAt,
            attempts: work.attempts + 1,
            failure,
            ...(resetCursor && work.kind === 'permissions' ? { permissionStartedAt: null } : {}),
          },
        }),
        reconciliationSafe: false,
        listingFailures: {
          count: (previous.failures?.count ?? 0) + (work.hasFailure ? 0 : 1),
          samples: failureSamples.slice(0, MAX_LISTING_FAILURE_SAMPLES),
        },
        ...(unresolvedFailures >= MAX_UNRESOLVED_FAILURES_PER_PASS
          ? { resumeAt: new Date(now().getTime() + 5 * 60_000).toISOString() }
          : {}),
      }
    }
    /** A user without the service completes cleanly and is re-probed no sooner than the Directory refresh. */
    const skipped = (): ExternalDocumentList => ({
      documents: [],
      currentCursor,
      hasMore: true,
      nextCursor: nextCursor(next, {
        update: {
          partitionKey: work.partitionKey,
          kind: work.kind,
          cursor: null,
          completed: true,
          attempts: 0,
          failure: null,
          retryAt: new Date(
            now().getTime() +
              (work.kind === 'permissions'
                ? GOOGLE_COMPANY_PERMISSION_REFRESH_MS
                : Math.max(DIRECTORY_REFRESH_MS, input.syncIntervalMinutes * 60_000))
          ),
          ...(work.kind === 'permissions' ? { permissionStartedAt: null } : {}),
        },
      }),
    })
    let page: ExternalDocumentList
    try {
      page = await input.listDocuments(
        accessToken,
        sourceConfig,
        work.cursor ?? adapter.seed(work.context),
        syncContext
      )
    } catch (error) {
      signal?.throwIfAborted()
      if (input.isListingCursorInvalidError?.(error))
        return failed(
          { scope: work.context.email, operation: 'google.user.cursor', reasons: [] },
          false,
          true
        )
      if (isGoogleWorkspaceServiceNotEnabled(error)) return skipped()
      const failure = deferredUserFailure(error, work.context)
      if (!failure) throw error
      return failed(failure, true)
    }
    if (page.listingFailures)
      return failed(
        page.listingFailures.samples[0] ?? {
          scope: work.context.email,
          operation: 'google.user.list',
          reasons: [],
        }
      )
    if (
      page.hasMore &&
      (!page.nextCursor || page.nextCursor === (page.currentCursor ?? work.cursor))
    ) {
      throw new Error('Google user listing did not advance its provider continuation')
    }
    unresolvedFailures = 0
    permissionStartedAt =
      work.kind === 'permissions' ? (work.permissionStartedAt ?? now()) : undefined
    if (page.currentCursor)
      changes.set(currentCursor, {
        pin: {
          partitionKey: work.partitionKey,
          kind: work.kind,
          cursor: page.currentCursor,
          permissionStartedAt,
        },
      })
    return {
      ...page,
      currentCursor,
      hasMore: true,
      ...(work.kind === 'permissions' ? { permissionsOnly: true } : {}),
      nextCursor: nextCursor(next, {
        update: {
          partitionKey: work.partitionKey,
          kind: work.kind,
          cursor: page.nextCursor ?? null,
          completed: !page.hasMore,
          attempts: 0,
          failure: null,
          retryAt: !page.hasMore
            ? new Date(
                now().getTime() +
                  (work.kind === 'permissions'
                    ? GOOGLE_COMPANY_PERMISSION_REFRESH_MS
                    : input.syncIntervalMinutes * 60_000)
              )
            : now(),
          ...(work.kind === 'permissions'
            ? { permissionStartedAt: page.hasMore ? permissionStartedAt : null }
            : {}),
        },
      }),
    }
  }
  return {
    listDocuments,
    permissionStartedAt: () => permissionStartedAt,
    changesFor: (cursor: string | null): ConnectorPartitionWorkChanges | undefined =>
      cursor ? changes.get(cursor) : undefined,
    didCommit: (cursor: string | null) => {
      if (cursor) changes.delete(cursor)
    },
  }
}
