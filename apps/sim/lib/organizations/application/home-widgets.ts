import { createLogger } from '@sim/logger'
import { compareStrings } from '@sim/utils/string'
import type {
  HomeWidgetAccount,
  OrganizationHomeCalendar,
  OrganizationHomeEmail,
} from '@/lib/api/contracts/organization-home'
import {
  loadAssistantIntegrationTools,
  loadAssistantProviderAccess,
} from '@/lib/assistant-actions/catalog'
import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { addCalendarDays, zonedWallClockToUtc } from '@/lib/core/utils/timezone'
import { defineOrganizationAccountsUseCase } from '@/lib/credential-groups/application/organization-accounts'
import {
  type CredentialGroupProvider,
  findCredentialGroupProviderFromProviderId,
} from '@/lib/credential-groups/providers'
import { listViewerOrganizationAccounts } from '@/lib/credential-groups/viewer-accounts'
import { ManagedOAuthCredentialError } from '@/lib/credentials/managed-oauth'
import { getOwnOrganizationManagedOAuthCredentials } from '@/lib/credentials/organization-managed'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import {
  type AccountTokenRead,
  createAccountTokenRead,
  type ProviderTokenInput,
} from '@/lib/organizations/home/account-token'
import {
  HOME_CALENDAR_EVENT_LIMIT,
  HOME_EMAIL_THREAD_LIMIT,
  HOME_WIDGET_ACCOUNT_LIMIT,
} from '@/lib/organizations/home/limits'
import {
  type GmailThreadCursor,
  gmailThreadsStillNeeded,
  type HomeCalendarEvent,
  type HomeCalendarWindow,
  type HomeEmailThread,
  HomeProviderReadError,
  readGmailThreads,
  readGoogleCalendarDay,
  readMoreGmailThreads,
  readOutlookCalendarDay,
  readOutlookMessages,
} from '@/lib/organizations/home/provider-reads'
import { canConnectSearchIntegrations } from '@/lib/organizations/surface'

const logger = createLogger('OrganizationHomeWidgets')

const READ_TIMEOUT_MS = 20_000

/**
 * Session-only, so no API key, delegated service or Copilot run can read a member's mail through
 * these. Both carry the capability behind the connected-accounts read that lists the same accounts.
 */
export const organizationHomeOperations = {
  readEmail: defineOrganizationOperation({
    id: 'organization_home.email.read',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
  readCalendar: defineOrganizationOperation({
    id: 'organization_home.calendar.read',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
} as const

const REAUTH_ERROR_CODES: ReadonlySet<ManagedOAuthCredentialError['code']> = new Set([
  'MANAGED_CREDENTIAL_NEEDS_REAUTH',
  'MANAGED_CREDENTIAL_REVOKED',
  'MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE',
])

/** Sorts a failed read into the widget's states. Logs only its classification, never a response. */
function failedState(
  error: unknown,
  meta: { organizationId: string; credentialId: string; providerId: string }
): Exclude<HomeWidgetAccount['state'], 'ready' | 'not_read' | 'not_offered'> {
  if (error instanceof HomeProviderReadError && error.failure === 'needs_reauth')
    return 'needs_reauth'
  if (error instanceof ManagedOAuthCredentialError && REAUTH_ERROR_CODES.has(error.code))
    return 'needs_reauth'
  logger.warn('A Home widget could not read a connected account', {
    ...meta,
    reason:
      error instanceof HomeProviderReadError
        ? error.failure
        : error instanceof ManagedOAuthCredentialError
          ? error.code
          : error instanceof Error
            ? error.name
            : 'unknown',
    httpStatus: error instanceof HomeProviderReadError ? error.httpStatus : undefined,
  })
  return 'unavailable'
}

interface WidgetReadResult<T> {
  accounts: HomeWidgetAccount[]
  rows: (T & { credentialId: string })[]
}

/** One account's read: which grant it is, and how many accounts this widget read is sharing. */
interface ViewerAccountRead extends ProviderTokenInput {
  providerSubjectId: string | null
  readableAccounts: number
  withToken: AccountTokenRead
}

type ViewerAccountReader<T> = (accessToken: string, account: ViewerAccountRead) => Promise<T[]>

/**
 * Reads the viewer's own accounts for a widget. The account list is scoped to the acting user's
 * enrollments and no input names a credential, so a request cannot reach another member's grant;
 * each one then proves a verified owner and a live binding again before its token is resolved.
 */
async function readViewerAccounts<T>(
  context: OrganizationMembershipContext,
  readers: Partial<Record<CredentialGroupProvider, ViewerAccountReader<T>>>
): Promise<WidgetReadResult<T>> {
  const { organizationId, userId } = context
  const [{ providers: allowed, config }, memberScoped] = await Promise.all([
    loadAssistantIntegrationTools({ organizationId, userId }),
    isKnowledgeMemberAccessAvailable({ organizationId }),
  ])
  // The member Integrations page's rule, less what the use case established before running this.
  if (!memberScoped || !canConnectSearchIntegrations(config))
    throw new OrchestrationError('forbidden', 'Integrations are not available to you here')
  // The boundary the assistant's direct tools answer to, which a widget must not sidestep. Read
  // fresh on each widget read, so a revoked approval or a tightened policy applies on the next one.
  const [accounts, owned, isProviderContentReadable] = await Promise.all([
    listViewerOrganizationAccounts({ organizationId, userId }),
    getOwnOrganizationManagedOAuthCredentials({ organizationId, userId }),
    loadAssistantProviderAccess(organizationId),
  ])
  const candidates = accounts
    .flatMap((account) => {
      const provider = findCredentialGroupProviderFromProviderId(account.providerId)
      const read = provider && readers[provider]
      return provider && read ? [{ ...account, provider, read }] : []
    })
    .sort((left, right) => compareStrings(left.credentialId, right.credentialId))
  if (candidates.length === 0) return { accounts: [], rows: [] }
  const ownedIds = new Set(owned.map((credential) => credential.id))
  const readable = new Map(
    [...new Set(candidates.map((candidate) => candidate.providerId))].map((providerId) => [
      providerId,
      isProviderContentReadable(providerId),
    ])
  )

  const isReadable = ({
    provider,
    providerId,
    status,
    credentialId,
  }: (typeof candidates)[number]) =>
    allowed.includes(provider) &&
    readable.get(providerId) === true &&
    status !== 'needs_reauth' &&
    ownedIds.has(credentialId)
  const toRead = new Set(
    candidates
      .filter(isReadable)
      .slice(0, HOME_WIDGET_ACCOUNT_LIMIT)
      .map((candidate) => candidate.credentialId)
  )

  const results = await Promise.all(
    candidates.map(async (candidate) => {
      const { credentialId, providerSubjectId, displayName, provider, providerId, status, read } =
        candidate
      const settled = (state: HomeWidgetAccount['state'], rows: T[] = []) => ({
        account: { credentialId, displayName, state },
        rows: rows.map((row) => ({ ...row, credentialId })),
      })
      if (!allowed.includes(provider) || !readable.get(providerId)) return settled('not_offered')
      if (status === 'needs_reauth') return settled('needs_reauth')
      if (!ownedIds.has(credentialId)) return settled('not_offered')
      if (!toRead.has(credentialId)) return settled('not_read')
      try {
        const tokenInput = { context, credentialId, providerId }
        const account = {
          ...tokenInput,
          providerSubjectId,
          readableAccounts: toRead.size,
          withToken: createAccountTokenRead(tokenInput),
        }
        return settled(
          'ready',
          await account.withToken((accessToken) => read(accessToken, account))
        )
      } catch (error) {
        return settled(failedState(error, { organizationId, credentialId, providerId }))
      }
    })
  )
  return {
    accounts: results.map((result) => result.account),
    rows: results.flatMap((result) => result.rows),
  }
}

interface GmailAccountCursor extends GmailThreadCursor {
  account: ViewerAccountRead
}

/**
 * Completes the merge a per-account budget started, so the rows match reading every thread of every
 * account: a busy mailbox still fills the list, and a quiet one leaves its share to the others. A
 * failure here fails the account.
 */
async function readRemainingGmailThreads(
  { accounts, rows }: WidgetReadResult<HomeEmailThread>,
  cursors: Map<string, GmailAccountCursor>,
  signal: AbortSignal
) {
  for (;;) {
    const needed = gmailThreadsStillNeeded(rows, cursors, HOME_EMAIL_THREAD_LIMIT)
    if (needed.size === 0) return
    await Promise.all(
      [...needed].map(async ([credentialId, count]) => {
        const cursor = cursors.get(credentialId)
        if (!cursor) return
        try {
          const threads = await cursor.account.withToken((accessToken) =>
            readMoreGmailThreads({ accessToken, signal, cursor, count })
          )
          rows.push(...threads.map((thread) => ({ ...thread, credentialId })))
        } catch (error) {
          cursors.delete(credentialId)
          const { context, providerId } = cursor.account
          const state = failedState(error, {
            organizationId: context.organizationId,
            credentialId,
            providerId,
          })
          for (const account of accounts)
            if (account.credentialId === credentialId) account.state = state
          for (let index = rows.length - 1; index >= 0; index--)
            if (rows[index].credentialId === credentialId) rows.splice(index, 1)
        }
      })
    )
  }
}

/** The viewer's latest mail across the email accounts they connected. */
export const readOrganizationHomeEmail = defineOrganizationAccountsUseCase({
  operation: organizationHomeOperations.readEmail,
  async execute({ context }): Promise<OrganizationHomeEmail> {
    const signal = AbortSignal.timeout(READ_TIMEOUT_MS)
    const cursors = new Map<string, GmailAccountCursor>()
    const result = await readViewerAccounts<HomeEmailThread>(context, {
      gmail: async (accessToken, account) => {
        const { threads, cursor } = await readGmailThreads({
          accessToken,
          signal,
          credentialId: account.credentialId,
          providerSubjectId: account.providerSubjectId,
          count: Math.ceil(HOME_EMAIL_THREAD_LIMIT / account.readableAccounts),
        })
        cursors.set(account.credentialId, { ...cursor, account })
        return threads
      },
      outlook: (accessToken) => readOutlookMessages({ accessToken, signal }),
    })
    await readRemainingGmailThreads(result, cursors, signal)
    const { accounts, rows } = result
    return {
      accounts,
      threads: rows
        .sort((left, right) => compareStrings(right.receivedAt, left.receivedAt))
        .slice(0, HOME_EMAIL_THREAD_LIMIT),
    }
  },
})

function dayWindow(date: string, timeZone: string): HomeCalendarWindow {
  return {
    startAt: zonedWallClockToUtc(`${date}T00:00`, timeZone).toISOString(),
    endAt: zonedWallClockToUtc(`${addCalendarDays(date, 1)}T00:00`, timeZone).toISOString(),
  }
}

/** One day of the viewer's meetings across the calendar accounts they connected. */
export const readOrganizationHomeCalendar = defineOrganizationAccountsUseCase({
  operation: organizationHomeOperations.readCalendar,
  async execute({
    input,
    context,
  }: {
    input: { organizationId: string; date: string; timeZone: string }
    context: OrganizationMembershipContext
  }): Promise<OrganizationHomeCalendar> {
    const signal = AbortSignal.timeout(READ_TIMEOUT_MS)
    const window = dayWindow(input.date, input.timeZone)
    const { accounts, rows } = await readViewerAccounts<HomeCalendarEvent>(context, {
      'google-calendar': (accessToken) => readGoogleCalendarDay({ accessToken, signal, window }),
      outlook: (accessToken) => readOutlookCalendarDay({ accessToken, signal, window }),
    })
    return {
      accounts,
      window,
      events: rows
        .sort((left, right) => compareStrings(left.startAt, right.startAt))
        .slice(0, HOME_CALENDAR_EVENT_LIMIT),
    }
  },
})
