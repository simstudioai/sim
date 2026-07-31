import { useCallback, useMemo } from 'react'
import { generateId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import { useCreateWorkflow, useWorkflowMap } from '@/hooks/queries/workflows'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { generateCreativeWorkflowName } from '@/stores/workflows/registry/utils'

interface UseWorkflowOperationsProps {
  workspaceId: string
}

export function useWorkflowOperations({ workspaceId }: UseWorkflowOperationsProps) {
  const router = useRouter()
  const { data: workflows = {}, isLoading: workflowsLoading } = useWorkflowMap(workspaceId)
  const createWorkflowMutation = useCreateWorkflow()

  const regularWorkflows = useMemo(
    () =>
      Object.values(workflows)
        .filter((workflow) => workflow.workspaceId === workspaceId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [workflows, workspaceId]
  )

  // `mutate` is stable; the mutation object it hangs off is a new literal every
  // render, so depending on the object would leave this callback unmemoized.
  const createWorkflowMutate = createWorkflowMutation.mutate

  const handleCreateWorkflow = useCallback((): Promise<string | null> => {
    const { clearDiff } = useWorkflowDiffStore.getState()
    clearDiff()

    const name = generateCreativeWorkflowName()
    const id = generateId()

    createWorkflowMutate({
      workspaceId,
      name,
      id,
    })

    useWorkflowRegistry.getState().markWorkflowCreating(id)
    router.push(`/workspace/${workspaceId}/w/${id}`)
    return Promise.resolve(id)
  }, [createWorkflowMutate, workspaceId, router])

  return {
    workflows,
    regularWorkflows,
    workflowsLoading,
    isCreatingWorkflow: createWorkflowMutation.isPending,

    handleCreateWorkflow,
  }
}
