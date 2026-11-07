'use client'

import type { OrganizationDataRetention } from '@/lib/api/contracts/organization'
import { normalizeRuleStages } from '@/lib/guardrails/pii-entities'
import {
  useOrganizationRetention,
  useUpdateOrganizationRetention,
} from '@/ee/data-retention/hooks/data-retention'
import {
  buildRetentionUpdate,
  hoursToDisplayDays,
  type RetentionSnapshot,
} from '@/ee/data-retention/lib/policy-draft'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

function snapshotFrom(data: OrganizationDataRetention): RetentionSnapshot {
  const rules = data.configured.piiRedaction?.rules ?? []
  const defaultRule = rules.find((rule) => rule.workspaceId === null)
  return {
    logDays: hoursToDisplayDays(data.effective.logRetentionHours),
    softDeleteDays: hoursToDisplayDays(data.effective.softDeleteRetentionHours),
    taskCleanupDays: hoursToDisplayDays(data.effective.taskCleanupHours),
    defaultPii: defaultRule
      ? { id: defaultRule.id, stages: normalizeRuleStages(defaultRule) }
      : null,
    piiOverrides: rules.flatMap((rule) =>
      rule.workspaceId === null
        ? []
        : [{ id: rule.id, workspaceId: rule.workspaceId, stages: normalizeRuleStages(rule) }]
    ),
    overrides: data.configured.retentionOverrides ?? [],
  }
}

/**
 * The organization's retention document as the policy snapshot the editor works on, and the
 * organization's workspaces an override can name.
 */
export function useRetentionSettings(organizationId: string) {
  const retention = useOrganizationRetention(organizationId)
  const workspaces = useWorkspacesQuery(Boolean(organizationId))
  return {
    read: {
      data: retention.data && {
        isEnterprise: retention.data.isEnterprise,
        snapshot: snapshotFrom(retention.data),
      },
      error: retention.error,
      isFetching: retention.isFetching,
      refetch: retention.refetch,
    },
    /** Re-reads the document; null when the latest cannot be confirmed. */
    readLatest: async () => {
      // A failed refetch still resolves, carrying the last good document.
      const { data, isError } = await retention.refetch()
      return data && !isError ? snapshotFrom(data) : null
    },
    workspacesPending: workspaces.isPending,
    workspacesFailed: !workspaces.data,
    workspacesRetrying: workspaces.isFetching,
    retryWorkspaces: () => void workspaces.refetch(),
    workspaceOptions: (workspaces.data ?? [])
      .filter((workspace) => workspace.organizationId === organizationId)
      .map((workspace) => ({ value: workspace.id, label: workspace.name })),
  }
}

/** The whole document is one save: the route replaces each key, so all of it is always sent. */
export function useRetentionWrites(organizationId: string) {
  const update = useUpdateOrganizationRetention()
  return {
    saving: update.isPending,
    persist: async (next: RetentionSnapshot) => {
      await update.mutateAsync({ orgId: organizationId, settings: buildRetentionUpdate(next) })
    },
  }
}
