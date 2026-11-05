'use client'

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { formatQuotedNameList, normalizeEmail } from '@sim/utils/string'
import type { PersonalOrganizationAccount } from '@/lib/api/contracts/organization-accounts'
import { clearBrowserUserData } from '@/lib/auth/browser-storage'
import { signOut } from '@/lib/auth/client'
import { summarizeOAuthAccess } from '@/lib/auth/oauth-provider'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  getManagedMcpConnector,
  isManagedMcpConnectorId,
} from '@/lib/credential-groups/managed-mcp-connectors'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import {
  groupByOrganization,
  PERSONAL_ACCOUNT_STATUS_LABELS,
} from '@/lib/organizations/personal-accounts'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { useAccountDeletionPlan, useDeleteAccount } from '@/hooks/queries/account-deletion'
import { useAuthorizedApps, useRevokeAuthorizedApp } from '@/hooks/queries/oauth-provider'
import {
  useDisconnectPersonalOrganizationAccount,
  usePersonalOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'
import { useResetPassword, useUserProfile } from '@/hooks/queries/user-profile'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useSettingsSearch } from '@/hooks/use-settings-search'
import { loadMoreOf, queryView } from '@/platform/lib/data/query-view'
import { toast } from '@/platform/lib/data/toast'
import { formatInstantDate } from '@/platform/lib/time'

const logger = createLogger('PlatformAccount')

/** Matches the naming used in the server's blocker sentences. */
const MAX_NAMES_LISTED = 3

/** How long the post-deletion sign-out may take before the redirect goes anyway. */
const SIGN_OUT_TIMEOUT_MS = 3000

const LOGOUT_PATH = '/login?fromLogout=true'

export function useAccountEmail() {
  const profile = useUserProfile()
  return profile.data?.email
}

export function useResetPasswordAction() {
  const reset = useResetPassword()
  return async (email: string) => {
    await reset.mutateAsync({ email, redirectTo: `${getBaseUrl()}/reset-password` })
    toast.success(`Password reset link sent to ${email}`)
  }
}

export function useAuthorizedAppsList() {
  const [search, setSearch] = useSettingsSearch()
  const term = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS).trim()
  const apps = useAuthorizedApps(term)
  const revoke = useRevokeAuthorizedApp()
  return {
    search,
    term,
    setSearch,
    ...queryView(apps),
    error: apps.error?.message,
    apps: (apps.data?.pages.flatMap((page) => page.apps) ?? []).map((app) => ({
      id: app.clientId,
      name: app.name,
      access: summarizeOAuthAccess(app.scopes),
      authorized: `Authorized ${formatInstantDate(app.authorizedAt)}`,
    })),
    loadMore: loadMoreOf(apps, 'Failed to load more authorized apps'),
    revoke: async (id: string, name: string) => {
      await revoke.mutateAsync(id)
      toast.success(`Revoked ${name}`)
    },
  }
}

function accountServiceName(account: PersonalOrganizationAccount): string {
  if (account.kind === 'mcp') {
    return isManagedMcpConnectorId(account.providerId)
      ? getManagedMcpConnector(account.providerId).name
      : account.providerId
  }
  return getServiceConfigByProviderId(account.providerId)?.name ?? account.providerId
}

export function usePersonalAccountsList() {
  const accounts = usePersonalOrganizationAccounts()
  const disconnect = useDisconnectPersonalOrganizationAccount()
  const list = accounts.data?.pages.flatMap((page) => page.accounts) ?? []
  return {
    ...queryView(accounts),
    error: accounts.error?.message,
    groups: groupByOrganization(list).map(([id, group]) => ({
      id,
      name: group.name,
      accounts: group.accounts.map((account) => ({
        id: account.credentialId,
        organizationId: account.organizationId,
        organizationName: account.organizationName,
        name: account.displayName,
        providerId: account.providerId,
        service: accountServiceName(account),
        status: PERSONAL_ACCOUNT_STATUS_LABELS[account.status],
        canDisconnect: account.status !== 'revoked',
      })),
    })),
    loadMore: loadMoreOf(accounts, 'Failed to load connected accounts'),
    disconnect: async (credentialId: string, organizationId: string, name: string) => {
      await disconnect.mutateAsync({ credentialId, organizationId })
      toast.success(`Disconnected ${name}`)
    },
  }
}

/**
 * The deletion consent. A fresh plan is fetched each time the dialog opens, and confirm holds on
 * `isFetching`: a blocker must reflect the account as it is right now.
 */
export function useAccountDeletion(email: string, legacyOrigin: string) {
  const plan = useAccountDeletionPlan(true)
  const remove = useDeleteAccount()
  const toDelete = plan.data?.workspacesToDelete ?? []
  const toTransfer = plan.data?.workspacesToTransfer ?? []
  return {
    fetching: plan.isFetching,
    loaded: Boolean(plan.data),
    planError: plan.error
      ? 'Could not check whether this account can be deleted. Try again.'
      : undefined,
    blockers: plan.data?.blockers ?? [],
    deletedCount: toDelete.length,
    deletedNames: formatQuotedNameList(
      toDelete.map((workspace) => workspace.name),
      MAX_NAMES_LISTED
    ),
    transferredCount: toTransfer.length,
    transferredNames: formatQuotedNameList(
      toTransfer.map((workspace) => workspace.name),
      MAX_NAMES_LISTED
    ),
    matches: (confirmation: string) => normalizeEmail(confirmation) === normalizeEmail(email),
    /**
     * The session is gone once this succeeds, so signing out can only drop its cookie. The race
     * keeps a hung request from stranding the viewer: the account is deleted either way, and the
     * full document load discards anything the cleanup missed.
     */
    confirm: async (confirmEmail: string) => {
      try {
        await remove.mutateAsync({ confirmEmail })
      } catch (error) {
        logger.error('Account deletion failed', { error })
        throw new Error(getErrorMessage(error, 'Could not delete this account'))
      }
      await Promise.race([
        Promise.allSettled([signOut()]).then(() => clearBrowserUserData()),
        sleep(SIGN_OUT_TIMEOUT_MS),
      ])
      window.location.href = `${legacyOrigin}${LOGOUT_PATH}`
    },
  }
}
