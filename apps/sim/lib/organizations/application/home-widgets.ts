import { credentialGroup as credentialGroupTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { compareStrings } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import type {
  HomeWidgetAccount,
  OrganizationHomeCalendar,
  OrganizationHomeEmail,
} from '@/lib/api/contracts/organization-home'
import {
  loadAssistantIntegrationTools,
  requireAssistantProviderAccess,
} from '@/lib/assistant-actions/catalog'
import type { OrganizationMembershipContext } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { zonedWallClockToUtc } from '@/lib/core/utils/timezone'
import { defineOrganizationAccountsUseCase } from '@/lib/credential-groups/application/organization-accounts'
import {
  type CredentialGroupProvider,
  findCredentialGroupProviderFromProviderId,
} from '@/lib/credential-groups/providers'
import { getOrganizationAccountsGroup } from '@/lib/credential-groups/service'
import { listViewerOrganizationAccounts } from '@/lib/credential-groups/viewer-accounts'
import {
  ManagedOAuthCredentialError,
  rejectManagedOAuthToken,
  resolveManagedOAuthToken,
} from '@/lib/credentials/managed-oauth'
import { getOwnOrganizationManagedOAuthCredentials } from '@/lib/credentials/organization-managed'
import { recordCredentialAccess } from '@/lib/oauth/token-resolution'
import {
  HOME_CALENDAR_EVENT_LIMIT,
  HOME_EMAIL_THREAD_LIMIT,
  HOME_WIDGET_ACCOUNT_LIMIT,
} from '@/lib/organizations/home/limits'
import {
  type HomeCalendarEvent,
  type HomeCalendarWindow,
  type HomeEmailThread,
  HomeProviderReadError,
  readGmailThreads,
  readGoogleCalendarDay,
  readOutlookCalendarDay,
  readOutlookMessages,
} from '@/lib/organizations/home/provider-reads'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'

const logger = createLogger('OrganizationHomeWidgets')

/** A widget gives up on a slow provider rather than holding its request open. */
const READ_TIMEOUT_MS = 20_000

type WidgetProvider = HomeWidgetAccount['provider']

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

/** The rule behind the member Integrations page; it has no inventory for anyone else to read. */
async function requireIntegrationsSurface({
  organizationId,
  userId,
}: OrganizationMembershipContext) {
  const surface = await getOrganizationSurfaceContext(organizationId, userId)
  if (
    !surface?.searchAccess.memberScoped ||
    !surface.viewer.canConnectSearchIntegrations ||
    !surface.connectedAccountsAvailable
  )
    throw new OrchestrationError('forbidden', 'Integrations are not available to you here')
}

function isWidgetProvider(
  provider: CredentialGroupProvider | null,
  providers: readonly WidgetProvider[]
): provider is WidgetProvider {
  return providers.some((candidate) => candidate === provider)
}

/** The boundary the assistant's direct tools answer to, which a widget must not sidestep. */
async function isProviderOffered(
  organizationId: string,
  providerId: string,
  allowed: readonly CredentialGroupProvider[],
  provider: WidgetProvider
) {
  if (!allowed.includes(provider)) return false
  try {
    await requireAssistantProviderAccess(organizationId, providerId)
    return true
  } catch (error) {
    if (error instanceof OrchestrationError && error.code === 'forbidden') return false
    throw error
  }
}

interface ProviderTokenInput {
  context: OrganizationMembershipContext
  credentialId: string
  providerId: string
}

function resolveToken({ context, credentialId, providerId }: ProviderTokenInput) {
  return resolveManagedOAuthToken({
    credentialId,
    organizationId: context.organizationId,
    expectedProviderId: providerId,
    requiredScopes: [],
  })
}

/** One read with the member's token, and one more with a refreshed token if the first is refused. */
async function readWithToken<T>(
  input: ProviderTokenInput,
  read: (accessToken: string) => Promise<T[]>
): Promise<T[]> {
  const { accessToken } = await resolveToken(input)
  recordCredentialAccess({
    actorId: input.context.userId,
    workspaceId: null,
    resourceId: input.credentialId,
    providerId: input.providerId,
    credentialType: 'oauth',
  })
  try {
    return await read(accessToken)
  } catch (error) {
    if (!(error instanceof HomeProviderReadError) || error.failure !== 'token_rejected') throw error
    const refreshed = await rejectManagedOAuthToken({
      credentialId: input.credentialId,
      organizationId: input.context.organizationId,
      expectedProviderId: input.providerId,
      requiredScopes: [],
      rejectedAccessToken: accessToken,
    })
    if (!refreshed) throw new HomeProviderReadError('needs_reauth', 401)
    const retry = await resolveToken(input)
    try {
      return await read(retry.accessToken)
    } catch (retryError) {
      if (retryError instanceof HomeProviderReadError && retryError.failure === 'token_rejected')
        throw new HomeProviderReadError('needs_reauth', 401)
      throw retryError
    }
  }
}

const REAUTH_ERROR_CODES: ReadonlySet<ManagedOAuthCredentialError['code']> = new Set([
  'MANAGED_CREDENTIAL_NEEDS_REAUTH',
  'MANAGED_CREDENTIAL_REVOKED',
  'MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE',
])

/** Sorts a failed read into the widget's states. Logs only its classification, never a response. */
function failedState(
  error: unknown,
  meta: { organizationId: string; credentialId: string; provider: WidgetProvider }
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

/**
 * Reads the viewer's own accounts for a widget. The account list is scoped to the acting user's
 * enrollments and no input names a credential, so a request cannot reach another member's grant;
 * each one then proves a verified owner and a live binding again before its token is resolved.
 */
async function readViewerAccounts<T>(
  context: OrganizationMembershipContext,
  readers: Partial<Record<WidgetProvider, (accessToken: string) => Promise<T[]>>>
): Promise<WidgetReadResult<T>> {
  await requireIntegrationsSurface(context)
  const { organizationId, userId } = context
  const group = await getOrganizationAccountsGroup(organizationId)
  if (!group) return { accounts: [], rows: [] }
  const providers = Object.keys(readers) as WidgetProvider[]
  const candidates = (
    await listViewerOrganizationAccounts({
      organizationId,
      userId,
      matching: eq(credentialGroupTable.id, group.id),
    })
  )
    .flatMap((account) => {
      const provider = findCredentialGroupProviderFromProviderId(account.providerId)
      return isWidgetProvider(provider, providers) ? [{ ...account, provider }] : []
    })
    .sort((left, right) => compareStrings(left.credentialId, right.credentialId))
  if (candidates.length === 0) return { accounts: [], rows: [] }
  const { providers: allowed } = await loadAssistantIntegrationTools({ organizationId, userId })

  const results = await Promise.all(
    candidates.map(async (candidate, index) => {
      const { credentialId, displayName, provider, providerId, status } = candidate
      const account = { credentialId, displayName, provider }
      const settled = (state: HomeWidgetAccount['state'], rows: T[] = []) => ({
        account: { ...account, state },
        rows: rows.map((row) => ({ ...row, credentialId })),
      })
      if (index >= HOME_WIDGET_ACCOUNT_LIMIT) return settled('not_read')
      if (!(await isProviderOffered(organizationId, providerId, allowed, provider)))
        return settled('not_offered')
      if (status === 'needs_reauth') return settled('needs_reauth')
      const [owned] = await getOwnOrganizationManagedOAuthCredentials({
        organizationId,
        userId,
        credentialId,
      })
      if (!owned) return settled('not_offered')
      const read = readers[provider]
      if (!read) return settled('not_offered')
      try {
        return settled('ready', await readWithToken({ context, credentialId, providerId }, read))
      } catch (error) {
        return settled(failedState(error, { organizationId, credentialId, provider }))
      }
    })
  )
  return {
    accounts: results.map((result) => result.account),
    rows: results.flatMap((result) => result.rows),
  }
}

/** The viewer's latest mail across the email accounts they connected. */
export const readOrganizationHomeEmail = defineOrganizationAccountsUseCase({
  operation: organizationHomeOperations.readEmail,
  async execute({ context }): Promise<OrganizationHomeEmail> {
    const signal = AbortSignal.timeout(READ_TIMEOUT_MS)
    const { accounts, rows } = await readViewerAccounts<HomeEmailThread>(context, {
      gmail: (accessToken) => readGmailThreads({ accessToken, signal }),
      outlook: (accessToken) => readOutlookMessages({ accessToken, signal }),
    })
    return {
      accounts,
      threads: rows
        .sort((left, right) => compareStrings(right.receivedAt, left.receivedAt))
        .slice(0, HOME_EMAIL_THREAD_LIMIT),
    }
  },
})

/** The next calendar day's midnight, written as a wall-clock reading. */
function nextDay(date: string) {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

function dayWindow(date: string, timeZone: string): HomeCalendarWindow {
  return {
    startAt: zonedWallClockToUtc(`${date}T00:00`, timeZone).toISOString(),
    endAt: zonedWallClockToUtc(`${nextDay(date)}T00:00`, timeZone).toISOString(),
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
