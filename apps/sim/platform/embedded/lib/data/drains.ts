'use client'

import { toError } from '@sim/utils/errors'
import type { CreateDataDrainBody, DataDrain } from '@/lib/api/contracts/data-drains'
import {
  useCreateDataDrain,
  useDataDrainRuns,
  useDataDrains,
  useDeleteDataDrain,
  useRunDataDrainNow,
  useTestDataDrain,
  useUpdateDataDrain,
} from '@/ee/data-drains/hooks/data-drains'
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
