import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
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
import { addCalendarDays, zonedWallClockToUtc } from '@/lib/core/utils/timezone'
import { defineOrganizationAccountsUseCase } from '@/lib/credential-groups/application/organization-accounts'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations'
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
  if (!surface || !canReadMemberIntegrations(surface))
    throw new OrchestrationError('forbidden', 'Integrations are not available to you here')
}

/** The boundary the assistant's direct tools answer to, which a widget must not sidestep. */
async function isProviderContentReadable(organizationId: string, providerId: string) {
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

function isTokenRejected(error: unknown) {
  return error instanceof HomeProviderReadError && error.failure === 'token_rejected'
}

/**
 * One read with the member's token, and one more with a fresh token if the first is refused. A
 * concurrent read of the same account may already have rotated it, so the fresh token is resolved
 * whether or not this call was the one that rejected the old token.
 */
async function readWithToken<T>(
  input: ProviderTokenInput,
  read: (accessToken: string) => Promise<T[]>
): Promise<T[]> {
  const { context, credentialId, providerId } = input
  const { accessToken } = await resolveToken(input)
  recordCredentialAccess({
    actorId: context.userId,
    workspaceId: null,
    resourceId: credentialId,
    providerId,
    credentialType: 'oauth',
  })
  try {
    return await read(accessToken)
  } catch (error) {
    if (!isTokenRejected(error)) throw error
  }
  const rejected = await rejectManagedOAuthToken({
    credentialId,
    organizationId: context.organizationId,
    expectedProviderId: providerId,
    requiredScopes: [],
    rejectedAccessToken: accessToken,
  })
  if (rejected)
    recordAudit({
      actorId: context.userId,
      action: AuditAction.CREDENTIAL_UPDATED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: credentialId,
      description: 'Marked provider-rejected managed OAuth credential as needing reauthorization',
      metadata: {
        organizationId: context.organizationId,
        provider: providerId,
        credentialType: 'managed_oauth',
      },
    })
  const retry = await resolveToken(input)
  try {
    return await read(retry.accessToken)
  } catch (error) {
    if (isTokenRejected(error)) throw new HomeProviderReadError('needs_reauth', 401)
    throw error
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

/**
 * Reads the viewer's own accounts for a widget. The account list is scoped to the acting user's
 * enrollments and no input names a credential, so a request cannot reach another member's grant;
 * each one then proves a verified owner and a live binding again before its token is resolved.
 */
async function readViewerAccounts<T>(
  context: OrganizationMembershipContext,
  readers: Partial<Record<CredentialGroupProvider, (accessToken: string) => Promise<T[]>>>
): Promise<WidgetReadResult<T>> {
  await requireIntegrationsSurface(context)
  const { organizationId, userId } = context
  const group = await getOrganizationAccountsGroup(organizationId)
  if (!group) return { accounts: [], rows: [] }
  const candidates = (
    await listViewerOrganizationAccounts({
      organizationId,
      userId,
      matching: eq(credentialGroupTable.id, group.id),
    })
  )
    .flatMap((account) => {
      const provider = findCredentialGroupProviderFromProviderId(account.providerId)
      const read = provider && readers[provider]
      return provider && read ? [{ ...account, provider, read }] : []
    })
    .sort((left, right) => compareStrings(left.credentialId, right.credentialId))
  if (candidates.length === 0) return { accounts: [], rows: [] }
  const [{ providers: allowed }, owned] = await Promise.all([
    loadAssistantIntegrationTools({ organizationId, userId }),
    getOwnOrganizationManagedOAuthCredentials({ organizationId, userId }),
  ])
  const ownedIds = new Set(owned.map((credential) => credential.id))
  const readable = new Map(
    await Promise.all(
      [...new Set(candidates.map((candidate) => candidate.providerId))].map(
        async (providerId) =>
          [providerId, await isProviderContentReadable(organizationId, providerId)] as const
      )
    )
  )

  const results = await Promise.all(
    candidates.map(async (candidate, index) => {
      const { credentialId, displayName, provider, providerId, status, read } = candidate
      const settled = (state: HomeWidgetAccount['state'], rows: T[] = []) => ({
        account: { credentialId, displayName, state },
        rows: rows.map((row) => ({ ...row, credentialId })),
      })
      if (index >= HOME_WIDGET_ACCOUNT_LIMIT) return settled('not_read')
      if (!allowed.includes(provider) || !readable.get(providerId)) return settled('not_offered')
      if (status === 'needs_reauth') return settled('needs_reauth')
      if (!ownedIds.has(credentialId)) return settled('not_offered')
      try {
        return settled('ready', await readWithToken({ context, credentialId, providerId }, read))
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
