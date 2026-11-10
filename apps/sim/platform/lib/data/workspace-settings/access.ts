'use client'

import { useMemo } from 'react'
import { getSubscriptionAccessState } from '@/lib/billing/client/utils'
import type { BooleanPermissionGroupConfigKey } from '@/lib/permission-groups/features'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useForkingAvailability } from '@/ee/workspace-forking/hooks/use-forking-available'
import { useDiscoverAccessRequests } from '@/hooks/queries/access-requests'
import { useInboxConfig } from '@/hooks/queries/inbox'
import { workspaceFeatureDiscoveryQuery } from '@/hooks/queries/utils/access-request-keys'
import { useWorkspaceHostContextQuery } from '@/hooks/queries/workspace-host'
import {
  resolveWorkspaceSettings,
  type WorkspaceSetting,
  type WorkspaceSettingsKey,
  workspaceSettingRestriction,
} from '@/platform/lib/data/workspace-settings/navigation'

/**
 * The viewer's Settings in one workspace: the host context every section reads and the sections the
 * legacy sidebar would list for them. `pending` until every read a gate depends on has answered, so
 * no section shows and then disappears.
 */
export function useWorkspaceSettings(workspaceId: string) {
  const host = useWorkspaceHostContextQuery(workspaceId)
  const policy = useUserPermissionConfig(workspaceId)
  const config = policy.data?.config
  const discovery = useDiscoverAccessRequests(workspaceFeatureDiscoveryQuery(workspaceId), true)
  const forking = useForkingAvailability(workspaceId)
  // The server refuses this read for a group that withholds the inbox, so it waits for the answer.
  const inbox = useInboxConfig(workspaceId, {
    enabled: policy.isSuccess && !config?.hideInboxTab,
  })
  const hostContext = host.data
  const groups = useMemo(() => {
    if (!hostContext) return []
    const access = getSubscriptionAccessState(hostContext.ownerBilling)
    return resolveWorkspaceSettings({
      hostContext,
      permissionConfig: config ?? {},
      requestable: new Set(
        discovery.data?.entries.flatMap((entry) =>
          entry.target.kind === 'feature' && entry.state === 'requestable'
            ? [entry.target.configKey]
            : []
        )
      ),
      hasUsableEnterpriseAccess: access.hasUsableEnterpriseAccess,
      hasUsableMaxAccess: access.hasUsableMaxAccess,
      forkingAvailable: forking.available,
      inboxEntitled: inbox.data?.entitled ?? false,
    })
  }, [hostContext, config, discovery.data, forking.available, inbox.data])
  const pending =
    host.isPending ||
    policy.isPending ||
    discovery.isPending ||
    forking.isLoading ||
    (inbox.isPending && inbox.fetchStatus !== 'idle')
  // A permission group that cannot be read would list the sections it withholds, so it fails too.
  const failed = host.isError || (policy.isError && !config)
  const status: 'pending' | 'error' | 'ready' = failed ? 'error' : pending ? 'pending' : 'ready'
  return {
    status,
    hostContext,
    groups,
    retry: () => {
      if (host.isError) void host.refetch()
      if (policy.isError) void policy.refetch()
    },
    section: (key: WorkspaceSettingsKey): WorkspaceSetting | undefined =>
      groups.flatMap((group) => group.items).find((item) => item.key === key),
    /** The request a restricted section offers, and whether the organization takes requests now. */
    restriction: (configKey: string) => ({
      accepting: discovery.data?.enabled ?? false,
      entry: discovery.data?.entries.find(
        (candidate) =>
          candidate.target.kind === 'feature' && candidate.target.configKey === configKey
      ),
    }),
  }
}

const MCP_RESTRICTION = workspaceSettingRestriction('mcp')
const SECRETS_RESTRICTION = workspaceSettingRestriction('secrets')

/**
 * What the viewer's permission group withholds in one workspace from the surfaces that list its MCP
 * servers, skills and secrets outside Settings: the flags Settings hides its MCP and Secrets sections
 * by, and the one that refuses `skills.use`. A group that cannot be read withholds all three, as
 * Settings shows no section it cannot judge. `settled` once the group answers, or with no workspace.
 */
export function useWorkspaceRestrictions(workspaceId: string | undefined) {
  const policy = useUserPermissionConfig(workspaceId)
  const config = policy.data?.config
  const withheld = (key: BooleanPermissionGroupConfigKey | undefined) =>
    !policy.isSuccess || Boolean(key && config?.[key])
  return {
    settled: !workspaceId || policy.isSuccess || policy.isError,
    mcp: withheld(MCP_RESTRICTION),
    skills: withheld('disableSkills'),
    secrets: withheld(SECRETS_RESTRICTION),
  }
}

/** What one section may do: its own entry and the workspace's host context, once both are known. */
export function useWorkspaceSettingsSection(workspaceId: string, key: WorkspaceSettingsKey) {
  const settings = useWorkspaceSettings(workspaceId)
  const entry = settings.section(key)
  return {
    hostContext: settings.hostContext,
    canMutate: entry?.canMutate ?? false,
    locked: entry?.locked ?? false,
    permission: settings.hostContext?.viewer.permission,
  }
}
