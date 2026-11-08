'use client'

import { toError } from '@sim/utils/errors'
import type { CreateDataDrainBody, DataDrain } from '@/lib/api/contracts/data-drains'
import type { OrganizationDataRetention } from '@/lib/api/contracts/organization'
import { normalizeRuleStages } from '@/lib/guardrails/pii-entities'
import {
  useCreateDataDrain,
  useDataDrainRuns,
  useDataDrains,
  useDeleteDataDrain,
  useRunDataDrainNow,
  useTestDataDrain,
  useUpdateDataDrain,
} from '@/ee/data-drains/hooks/data-drains'
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
import { reportFailure } from '@/platform/embedded/lib/notices'
import { useDataDrainParam } from '@/platform/shared/data-drains/params'
import { toast } from '@/platform/shared/toast'

const RECENT_RUN_LIMIT = 10

/** The organization's drains and the one the URL has open. */
export function useDrainSelection(organizationId: string) {
  const { data: drains, isPending, error, isFetching, refetch } = useDataDrains(organizationId)
  const [selectedId, setSelectedId] = useDataDrainParam()
  return {
    read: { data: drains, error, isFetching, refetch },
    drains,
    isPending,
    selectedId,
    setSelectedId,
    selected: selectedId ? drains?.find((drain) => drain.id === selectedId) : undefined,
  }
}

export function useDrainCreate(organizationId: string, onCreated: (drainId: string) => void) {
  const createDrain = useCreateDataDrain()
  return {
    pending: createDrain.isPending,
    error: createDrain.error,
    create: async (body: CreateDataDrainBody) => {
      try {
        const drain = await createDrain.mutateAsync({ organizationId, body })
        toast.success('Drain created')
        onCreated(drain.id)
      } catch (error) {
        reportFailure("Couldn't create drain", error)
      }
    },
  }
}

async function report(work: Promise<unknown>, success: string) {
  try {
    await work
    toast.success(success)
  } catch (error) {
    toast.error(toError(error).message)
  }
}

export function useDrainDetail(organizationId: string, drain: DataDrain) {
  const updateDrain = useUpdateDataDrain()
  const deleteDrain = useDeleteDataDrain()
  const runDrain = useRunDataDrainNow()
  const testDrain = useTestDataDrain()
  const runs = useDataDrainRuns(organizationId, drain.id, RECENT_RUN_LIMIT)
  // The runs query keeps previous data, which would read as another drain's history.
  const runsLoading = runs.isPending || runs.isPlaceholderData
  const target = { organizationId, drainId: drain.id }
  return {
    runs: { ...runs, data: runsLoading ? undefined : runs.data },
    updatePending: updateDrain.isPending,
    deletePending: deleteDrain.isPending,
    runPending: runDrain.isPending,
    testPending: testDrain.isPending,
    toggleEnabled: () =>
      void report(
        updateDrain.mutateAsync({ ...target, body: { enabled: !drain.enabled } }),
        drain.enabled ? 'Drain disabled' : 'Drain enabled'
      ),
    testConnection: () => void report(testDrain.mutateAsync(target), 'Connection test passed'),
    runNow: () => void report(runDrain.mutateAsync(target), 'Run queued'),
    remove: async () => {
      await deleteDrain.mutateAsync(target)
      toast.success('Drain deleted')
    },
  }
}

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
