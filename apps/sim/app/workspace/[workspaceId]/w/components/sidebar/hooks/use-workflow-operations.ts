import { useCallback, useMemo } from 'react'
import { generateId } from '@sim/utils/id'
import { useResourceRouter } from '@/app/workspace/[workspaceId]/components/resource/resource-navigation'
import { useCreateWorkflow, useWorkflowMap } from '@/hooks/queries/workflows'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { generateCreativeWorkflowName } from '@/stores/workflows/registry/utils'

interface UseWorkflowOperationsProps {
  workspaceId: string
}

export function useWorkflowOperations({ workspaceId }: UseWorkflowOperationsProps) {
  const router = useResourceRouter()
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

  /**
   * Creates a workflow filed under `folderId` (`null` for the workspace root) and opens it.
   * The canvas navigation is optimistic: the registry marks the id as creating so the
   * canvas waits for the row rather than 404ing on a workflow the server has not yet saved.
   */
  const handleCreateWorkflowInFolder = useCallback(
    (folderId: string | null): Promise<string | null> => {
      const { clearDiff } = useWorkflowDiffStore.getState()
      clearDiff()

      const name = generateCreativeWorkflowName()
      const id = generateId()

      createWorkflowMutate({
        workspaceId,
        ...(folderId ? { folderId } : {}),
        name,
        id,
        deduplicate: true,
      })

      useWorkflowRegistry.getState().markWorkflowCreating(id)
      router.push(`/workspace/${workspaceId}/w/${id}`)
      return Promise.resolve(id)
    },
    [createWorkflowMutate, workspaceId, router]
  )

  /** Creates at the workspace root. Takes no arguments so it can be wired straight to a click. */
  const handleCreateWorkflow = useCallback(
    (): Promise<string | null> => handleCreateWorkflowInFolder(null),
    [handleCreateWorkflowInFolder]
  )

  return {
    workflows,
    regularWorkflows,
    workflowsLoading,
    isCreatingWorkflow: createWorkflowMutation.isPending,

    handleCreateWorkflow,
    handleCreateWorkflowInFolder,
  }
}
