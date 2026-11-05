'use client'

import { isApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import { buildHostedUpgradeUrl, HOSTED_BILLING_SETTINGS_URL } from '@/lib/billing/upgrade-reasons'
import { getDesktopBridge } from '@/lib/desktop'
import { searchConnectionTargetSchema } from '@/lib/knowledge/search/connection-target'
import { CredentialWorkspaceContext } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/credential-workspace-context'
import {
  type CredentialItemData,
  formatCredentialSubmissionMessage,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/parse'
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

const BASE_PATH = process.env.NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH ?? ''

/** The card's workspace target, read by the connection hooks in place of a workspace route. */
export const CredentialWorkspaceProvider = CredentialWorkspaceContext.Provider
export { useOAuthChipConnection }

/** A Search source this row connects, when its tag item parses as one. */
export function parseSearchTarget(item: PlatformCredentialRequest) {
  const target = searchConnectionTargetSchema.safeParse(item.source)
  return target.success ? target.data : null
}

export function useSearchConnectionRow(
  item: PlatformCredentialRequest,
  controlId: string,
  onConnected: () => void
) {
  const { organization } = useOrganization()
  const { data: session } = useSession()
  const target = parseSearchTarget(item)
  return useSearchIntegrationConnection({
    organizationId: organization.id,
    userId: session?.user?.id ?? '',
    // The row renders only for an item that parsed.
    target: target as NonNullable<typeof target>,
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
  return {
    gate: hasOrganization ? organizationSecretGate(source, organization.viewer.isAdmin) : null,
    async save(scope: string, workspaceId: string, variables: Record<string, string>) {
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
        const { data: latest } = await personal.refetch()
        const merged: Record<string, string> = {}
        for (const [key, entry] of Object.entries(latest ?? personal.data ?? {})) {
          merged[key] = entry.value
        }
        await savePersonal.mutateAsync({ variables: { ...merged, ...variables } })
        return
      }
      await upsertWorkspace.mutateAsync({ workspaceId, variables })
    },
  }
}

/** Names only: the message the chat pairs back to this card never carries a secret's value. */
export function credentialSubmissionMessage(
  items: readonly PlatformCredentialRequest[],
  connectedIntegrations: ReadonlySet<number>,
  savedSecrets: ReadonlySet<number>
): string {
  return formatCredentialSubmissionMessage(
    items.map((item) => item.source as CredentialItemData),
    { connectedIntegrationIndexes: connectedIntegrations, savedSecretIndexes: savedSecrets }
  )
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
      ? `${BASE_PATH}/settings/billing`
      : upgrade
        ? buildHostedUpgradeUrl()
        : HOSTED_BILLING_SETTINGS_URL,
  }
}
