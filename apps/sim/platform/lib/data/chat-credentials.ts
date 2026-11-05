'use client'

import { isApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import { buildHostedUpgradeUrl, HOSTED_BILLING_SETTINGS_URL } from '@/lib/billing/upgrade-reasons'
import { getDesktopBridge } from '@/lib/desktop'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { CredentialWorkspaceContext } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/credential-workspace-context'
import { formatCredentialSubmissionMessage } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/parse'
import { useOAuthChipConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/use-oauth-chip-connection'
import {
  usePersonalEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import {
  useOrganizationSecretSource,
  useSaveOrganizationSecrets,
} from '@/hooks/queries/organization-secrets'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useSearchIntegrationConnection } from '@/hooks/use-search-integration-connection'
import type { PlatformCredentialRequest } from '@/platform/app/(shell)/_components/chat/model'
import { useOrganization } from '@/platform/lib/data/organization'
import { legacyRoutes } from '@/platform/lib/data/organization-model'
import { toast } from '@/platform/lib/data/toast'

/** The card's workspace target, read by the connection hooks in place of a workspace route. */
export const CredentialWorkspaceProvider = CredentialWorkspaceContext.Provider
export { useOAuthChipConnection }

export function useSearchConnectionRow(
  target: SearchConnectionTarget,
  controlId: string,
  onConnected: () => void
) {
  const { organization } = useOrganization()
  const { data: session } = useSession()
  return useSearchIntegrationConnection({
    organizationId: organization.id,
    userId: session?.user?.id ?? '',
    target,
    controlId,
    onConnected,
  })
}

/** Mounts the shared directory on desktop; undefined outside that host. */
export function useFolderAccess() {
  const bridge = getDesktopBridge()
  if (!bridge?.localFilesystem) return undefined
  return async (name: string | undefined): Promise<boolean> => {
    try {
      await bridge.localFilesystem?.({ operation: 'mount_directory' })
      toast.success(`Access granted — ${name ?? 'folder'}`)
      return true
    } catch {
      toast.error('Could not open that folder.')
      return false
    }
  }
}

export function useCredentialWorkspace(items: readonly PlatformCredentialRequest[]) {
  const { data: workspaces = [] } = useWorkspacesQuery()
  const workspaceId = items.find((item) => item.workspaceId)?.workspaceId ?? ''
  const workspace = workspaces.find((item) => item.id === workspaceId)
  return {
    workspaceId,
    canEdit: workspace?.permissions === 'admin' || workspace?.permissions === 'write',
  }
}

/** What stands between this viewer and saving a Generic Secret, in the legacy host's order. */
function organizationSecretGate(
  source: ReturnType<typeof useOrganizationSecretSource>,
  isAdmin: boolean
): string | null {
  if (source.isPending) return 'Loading Generic Secrets'
  if (source.isError) return 'Could not load Generic Secrets.'
  const current = source.data?.source
  if (!current)
    return isAdmin
      ? 'Enable Generic Secrets in organization Integrations settings, then return here to enter the keys.'
      : 'Ask an organization admin to enable Generic Secrets in Integrations.'
  if (current.mode === 'organization' && !isAdmin)
    return 'Ask an organization admin to add these shared Generic Secrets.'
  return null
}

/** Saves one scope's secrets, by the rule each scope's API needs. */
export function useSecretSaver(items: readonly PlatformCredentialRequest[]) {
  const organization = useOrganization()
  const organizationId = organization.organization.id
  const upsertWorkspace = useUpsertWorkspaceEnvironment()
  const savePersonal = useSavePersonalEnvironment()
  const personal = usePersonalEnvironment({
    enabled: items.some((item) => item.scope === 'personal'),
  })
  const hasOrganization = items.some((item) => item.scope === 'organization')
  const source = useOrganizationSecretSource(hasOrganization ? organizationId : '')
  const saveOrganization = useSaveOrganizationSecrets(organizationId)
  async function save(scope: string, workspaceId: string, variables: Record<string, string>) {
    if (scope === 'organization') {
      const current = source.data?.source
      if (!current) throw new Error('Generic Secrets are not enabled')
      try {
        await saveOrganization.mutateAsync({
          sourceId: current.id,
          mode: current.mode,
          upsert: variables,
          remove: [],
        })
      } catch (error) {
        // The server compares this source under lock, so a stale one must be read again.
        if (isApiClientError(error) && (error.status === 409 || error.status === 404))
          await source.refetch()
        throw error
      }
      return
    }
    if (scope === 'personal') {
      // Saving replaces the whole map, so it merges over the latest copy.
      const { data: latest } = await personal.refetch({ throwOnError: true })
      const merged: Record<string, string> = {}
      for (const [key, entry] of Object.entries(latest ?? {})) {
        merged[key] = entry.value
      }
      await savePersonal.mutateAsync({ variables: { ...merged, ...variables } })
      return
    }
    await upsertWorkspace.mutateAsync({ workspaceId, variables })
  }
  return {
    gate: hasOrganization ? organizationSecretGate(source, organization.viewer.isAdmin) : null,
    /**
     * Saves the entered secrets by scope, in parallel. A row that saved stays saved when another
     * fails. Only with nothing failed is there a message for the chat, which carries names only.
     */
    async submit({
      drafts,
      saved,
      connected,
      workspaceId,
    }: {
      drafts: Readonly<Record<number, string>>
      saved: ReadonlySet<number>
      connected: ReadonlySet<number>
      workspaceId: string
    }): Promise<{ saved: ReadonlySet<number>; message: string | null }> {
      const rows = items.flatMap((item, index) =>
        item.type === 'secret_input' && item.name
          ? [{ index, name: item.name, scope: item.scope ?? 'workspace' }]
          : []
      )
      const groups = new Map<string, Record<string, string>>()
      for (const { index, name, scope } of rows) {
        const value = drafts[index]?.trim()
        if (value && !saved.has(index)) groups.set(scope, { ...groups.get(scope), [name]: value })
      }
      const next = new Set(saved)
      const results = await Promise.allSettled(
        [...groups].map(async ([scope, variables]) => {
          await save(scope, workspaceId, variables)
          for (const row of rows)
            if (row.scope === scope && Object.hasOwn(variables, row.name)) next.add(row.index)
        })
      )
      if (results.some((result) => result.status === 'rejected')) {
        toast.error(`Couldn't save all secrets. Retry the remaining entries.`)
        return { saved: next, message: null }
      }
      const integrations = items.flatMap((item, index) =>
        item.type === 'link' || item.type === 'service_account' ? [index] : []
      )
      return {
        saved: next,
        message: formatCredentialSubmissionMessage(
          items.map((item) => item.source),
          {
            connectedIntegrationIndexes: new Set(
              integrations.flatMap((index, position) => (connected.has(index) ? [position] : []))
            ),
            savedSecretIndexes: new Set(
              rows.flatMap(({ index }, position) => (next.has(index) ? [position] : []))
            ),
          }
        ),
      }
    },
  }
}

export function useIntegrationsHref(): string {
  return legacyRoutes(useOrganization()).settingsSection('integrations')
}

/** Where a usage refusal sends this viewer, or who they need to ask. */
export function useUsageLink(action: string) {
  const organization = useOrganization()
  const { hosted } = organization.deployment
  const upgrade = action === 'upgrade_plan'
  return {
    canManage: !hosted || organization.viewer.isAdmin,
    upgrade,
    href: hosted
      ? '/settings/billing'
      : upgrade
        ? buildHostedUpgradeUrl()
        : HOSTED_BILLING_SETTINGS_URL,
  }
}
