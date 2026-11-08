'use client'

import type { SlackSearchInstallationView } from '@/lib/api/contracts/knowledge/slack'
import {
  useConfigureSlackSearch,
  useRemoveSlackSearch,
  useSlackSearchInstallations,
} from '@/hooks/queries/slack-search'
import {
  useRetrySlackSearchOnboarding,
  useSlackSearchOnboarding,
} from '@/hooks/queries/slack-search-onboarding'

/**
 * Where a Slack onboarding link stands on this organization's integrations page: unread, failed,
 * belonging to another organization or not yet ready to connect here, or back in the Slack thread.
 */
export function useSlackSearchHandoff(organizationId: string, token: string, userId: string) {
  const status = useSlackSearchOnboarding(token, userId)
  const retry = useRetrySlackSearchOnboarding(userId)
  const data = status.data
  const check = {
    checking: status.isFetching,
    check: () => void status.refetch(),
    checkError: status.isRefetchError ? status.error.message : null,
  }
  if (!data) return { stage: 'unread' as const, error: status.error?.message ?? null }
  if (!('organizationId' in data) || data.organizationId !== organizationId)
    return { stage: 'elsewhere' as const }
  return {
    stage: 'here' as const,
    ...check,
    slackUrl: data.slackUrl,
    ready: data.status === 'ready',
    retried: data.status === 'retried' || retry.isSuccess,
    retrying: retry.isPending,
    retry: () => retry.mutate({ token }),
    retryError: retry.isError ? retry.error.message : null,
  }
}

/**
 * The organization's Slack Search installations, read only for an admin, with how each one stands
 * and the row actions that change it.
 */
export function useSlackSearchConnections(organizationId: string, isAdmin: boolean) {
  const installations = useSlackSearchInstallations(isAdmin ? organizationId : undefined)
  const configure = useConfigureSlackSearch()
  const remove = useRemoveSlackSearch()
  const data = installations.data
  const canInstallSharedApp = !installations.error && data?.sharedAppAvailable
  const sharedTeams = new Set(
    data?.installations
      .filter((installation) => installation.appKind === 'shared')
      .map((installation) => installation.teamId)
  )
  return {
    read: installations,
    canInstallSharedApp,
    busy: configure.isPending || remove.isPending,
    updating: configure.isPending,
    updateError: configure.error,
    /** How one installation reads: its name, whether it needs the shared app or a reconnect, and why. */
    describe: (installation: SlackSearchInstallationView) => {
      const custom = installation.appKind === 'custom'
      const needsInstall = canInstallSharedApp && custom && !sharedTeams.has(installation.teamId)
      return {
        custom,
        name: custom ? 'Sim Search (custom bot)' : 'Sim Search',
        needsInstall,
        connectionError: needsInstall
          ? null
          : installation.needsValidation
            ? 'Reconnect to verify the app’s credentials and permissions.'
            : ['delivery_failed', 'assistant_or_delivery_failed'].includes(
                  installation.lastOutcome ?? ''
                )
              ? 'The last reply failed. Check the Slack connection.'
              : null,
        reconnectRequired: needsInstall || installation.needsValidation,
        botName: (data?.bots ?? []).find((bot) => bot.id === installation.credentialId)
          ?.displayName,
      }
    },
    toggleEnabled: (installation: SlackSearchInstallationView) =>
      configure.mutate({
        organizationId,
        credentialId: installation.credentialId,
        enabled: !installation.enabled,
      }),
    /** Clears a previous removal's failure before the next confirm opens. */
    resetRemove: () => remove.reset(),
    remove: async (installationId: string) => {
      await remove.mutateAsync({ organizationId, installationId })
    },
  }
}
