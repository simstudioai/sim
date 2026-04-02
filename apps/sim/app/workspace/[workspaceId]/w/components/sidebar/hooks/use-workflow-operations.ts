import { useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
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

  const handleCreateWorkflow = useCallback((): Promise<string | null> => {
    const { clearDiff } = useWorkflowDiffStore.getState()
    clearDiff()

    const name = generateCreativeWorkflowName()
    const color = getNextWorkflowColor()
    const id = crypto.randomUUID()

    createWorkflowMutation.mutate({
      workspaceId,
      name,
      color,
      id,
    })

    useWorkflowRegistry.getState().markWorkflowCreating(id)
    router.push(`/workspace/${workspaceId}/w/${id}`)
    return Promise.resolve(id)
  }, [createWorkflowMutation, workspaceId, router])

  return {
    workflows,
    regularWorkflows,
    workflowsLoading,
    isCreatingWorkflow: createWorkflowMutation.isPending,

    handleCreateWorkflow,
  }
}
